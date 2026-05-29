mod backend;
mod og_metadata;

use tauri::{command, AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use std::thread;
use std::time::Duration;
use serde_json::Value as JsonValue;

static MF_ZEN_LOOP_STARTED: AtomicBool = AtomicBool::new(false);
static ZEN_SCRIPT_CACHE: OnceLock<String> = OnceLock::new();

const PRE_NAVIGATE_CURTAIN: &str = r#"
(function() {
    if (document.getElementById('mf-curtain')) return;
    const d = document.createElement('div');
    d.id = 'mf-curtain';
    d.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:#000000;z-index:2147483647;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:\'Manrope\',-apple-system,BlinkMacSystemFont,sans-serif;transition:opacity 0.8s ease;';
    const html = '<style>@keyframes mf-spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}</style>' +
        '<div style="width:40px;height:40px;border:4px solid rgba(255,255,255,0.15);border-top:4px solid #4061ad;border-radius:50%;animation:mf-spin 1s linear infinite;margin-bottom:20px;"></div>' +
        '<h2 style="margin:0;letter-spacing:-0.02em;font-size:24px;color:#ffffff;font-weight:700;font-family:\'Manrope\',sans-serif;">Meshy<span style="font-family:\'Fraunces\',Georgia,serif;font-style:italic;font-weight:600;background:linear-gradient(110deg,#4061ad 0%,#6059a7 45%,#2fbebe 100%);-webkit-background-clip:text;background-clip:text;color:transparent;">Net</span></h2>' +
        '<p style="color:rgba(255,255,255,0.55);font-size:12px;text-transform:uppercase;letter-spacing:1px;margin-top:8px;font-weight:600;">Načítavanie...</p>';
    if (window.__mfSafeSetHTML) {
        window.__mfSafeSetHTML(d, html);
    } else {
        try { d.innerHTML = html; } catch(e) {}
    }
    document.documentElement.appendChild(d);
    document.documentElement.style.overflow = 'hidden';
})();
"#;

// ============================================================
// 📜 ZEN SCRIPT — server-side with bundled fallback
// ============================================================
// Tento fallback sa použije ak fetch zo Supabase pri štarte zlyhá.
// Pri úspešnom fetchi ho prepíše čerstvá verzia z `app_scripts` tabuľky.
const ZEN_SCRIPT_FALLBACK: &str = r#"
(function() {
    if (window.__mfConsoleOverrideDone) return;
    window.__mfConsoleOverrideDone = true;
    var oL = console.log, oW = console.warn, oE = console.error;
    var bl = [/self.?xss/i, /selfxss/i, /Stop!/, /funkcia prehliadača určená pre vývojárov/i, /This is a browser feature intended for developers/i];
    var ok = function(a) { var s = [].slice.call(a).map(function(x) { return typeof x === 'string' ? x : ''; }).join(' '); return !bl.some(function(p) { return p.test(s); }); };
    console.log = function() { if (ok(arguments)) oL.apply(console, arguments); };
    console.warn = function() { if (ok(arguments)) oW.apply(console, arguments); };
    console.error = function() { if (ok(arguments)) oE.apply(console, arguments); };
})();
try {
    if (!window.__mfHeartbeatLogged) {
        console.log('[MF] zen_script v3 running on:', window.location.hostname);
        window.__mfHeartbeatLogged = true;
        setTimeout(function() { window.__mfHeartbeatLogged = false; }, 5000);
    }
} catch(e) {}

if (typeof window.__mfDebug === 'undefined') window.__mfDebug = false;
function mfLog() {
    if (!window.__mfDebug) return;
    try { console.log.apply(console, ['[MF]'].concat(Array.from(arguments))); } catch(e){}
}

function getFullText(el) {
    if (!el) return '';
    let text = (el.innerText || '').trim();
    try {
        const before = getComputedStyle(el, '::before').content;
        const after = getComputedStyle(el, '::after').content;
        if (before && before !== 'none' && before !== 'normal') {
            text += ' ' + before.replace(/^["']|["']$/g, '');
        }
        if (after && after !== 'none' && after !== 'normal') {
            text += ' ' + after.replace(/^["']|["']$/g, '');
        }
    } catch(e) {}
    return text.replace(/\s+/g, ' ').trim();
}

function findPostWrapper(el) {
    if (!el) return null;
    const article = el.closest('div[role="article"]');
    if (article) return article;
    const feedUnit = el.closest('div[data-pagelet^="FeedUnit"]');
    if (feedUnit) return feedUnit;
    let curr = el;
    let best = null;
    for (let i = 0; i < 25; i++) {
        if (!curr.parentElement) break;
        curr = curr.parentElement;
        if (curr.tagName === 'BODY' || curr.tagName === 'HTML') break;
        if (curr.getAttribute('role') === 'main') break;
        const rect = curr.getBoundingClientRect();
        if (rect.width < 350 || rect.width > 850) continue;
        if (rect.height < 100) continue;
        const parent = curr.parentElement;
        if (!parent) continue;
        const sibs = Array.from(parent.children);
        const similar = sibs.filter(s => {
            if (s === curr) return false;
            const sr = s.getBoundingClientRect();
            return Math.abs(sr.width - rect.width) < 60 && sr.height >= 50;
        });
        if (similar.length >= 1 || parent.getAttribute('role') === 'feed') {
            best = curr;
        }
    }
    return best;
}

function hideEl(el, why) {
    if (!el || el.__mfHidden) return;
    if (el.id === 'mf-curtain' || (el.closest && el.closest('#mf-curtain'))) return;
    if (el.id === 'mf-overlay' || (el.closest && el.closest('#mf-overlay'))) return;
    if (el.getAttribute && el.getAttribute('role') === 'main') return;
    if (el.querySelector && el.querySelector('[role="main"]')) return;
    el.__mfHidden = true;
    el.style.setProperty('display', 'none', 'important');
    el.style.setProperty('visibility', 'hidden', 'important');
    el.style.setProperty('height', '0', 'important');
    mfLog('hide:', why, el);
}

{ const oldDiag = document.getElementById('mf-diag'); if (oldDiag) oldDiag.remove(); }

(function injectMfOverlay() {
    const PLATFORMS = [
        { id: 'fb', name: 'Facebook', match: /facebook\.com/ },
        { id: 'ig', name: 'Instagram', match: /instagram\.com/ },
        { id: 'yt', name: 'YouTube', match: /youtube\.com/ },
    ];
    const currentHost = window.location.hostname;
    const activePlatform = PLATFORMS.find(p => p.match.test(currentHost));

    if (!activePlatform) {
        const existing = document.getElementById('mf-overlay');
        if (existing) existing.remove();
        if (document.body) document.body.style.removeProperty('padding-top');
        const yta = document.querySelector('ytd-app');
        if (yta) yta.style.removeProperty('padding-top');
        return;
    }

    const isYT = activePlatform.id === 'yt';

    let overlay = document.getElementById('mf-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'mf-overlay';
        overlay.setAttribute('style',
            'position:fixed !important;top:0 !important;left:0 !important;right:0 !important;' +
            'background:#000000 !important;z-index:2147483647 !important;' +
            'padding:24px 16px 14px !important;' +
            "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif !important;" +
            'color:#ffffff !important;box-sizing:border-box !important;' +
            'border-bottom:0.5px solid rgba(255,255,255,0.10) !important;' +
            'pointer-events:auto !important;display:block !important;' +
            'transform:none !important;filter:none !important;'
        );
        document.documentElement.appendChild(overlay);
    } else if (overlay.parentNode !== document.documentElement) {
        try { document.documentElement.appendChild(overlay); } catch(e) {}
    }

    const sig = activePlatform.id;
    if (overlay.dataset.mfActive !== sig) {
        while (overlay.firstChild) overlay.removeChild(overlay.firstChild);

        const wrap = document.createElement('div');
        wrap.style.cssText = 'max-width:540px;margin:0 auto;';
        overlay.appendChild(wrap);

        const h1 = document.createElement('h1');
        h1.style.cssText = 'margin:0 0 4px;font-size:22px;font-weight:700;letter-spacing:-0.02em;color:#ffffff;line-height:1.2;';
        h1.appendChild(document.createTextNode('Meshy'));
        const feedEl = document.createElement('span');
        feedEl.textContent = 'Net';
        feedEl.style.cssText = 'font-family:\'Fraunces\',Georgia,serif;font-style:italic;font-weight:600;background:linear-gradient(110deg,#4061ad 0%,#6059a7 45%,#2fbebe 100%);-webkit-background-clip:text;background-clip:text;color:transparent;';
        h1.appendChild(feedEl);
        wrap.appendChild(h1);

        const subEl = document.createElement('p');
        subEl.textContent = 'Načítavanie...';
        subEl.style.cssText = 'margin:0 0 14px;font-size:13px;color:rgba(255,255,255,0.55);font-weight:400;';
        wrap.appendChild(subEl);

        const statusBar = document.createElement('div');
        statusBar.style.cssText = 'display:flex;align-items:center;gap:14px;padding:11px 16px;background:#0a0a0a;border:0.5px solid rgba(255,255,255,0.10);border-radius:10px;font-size:13px;color:rgba(255,255,255,0.55);flex-wrap:wrap;';
        wrap.appendChild(statusBar);

        const zdroje = document.createElement('span');
        zdroje.textContent = 'Zdroje';
        zdroje.style.cssText = 'color:#ffffff;font-weight:500;';
        statusBar.appendChild(zdroje);

        PLATFORMS.forEach((p) => {
            const isActive = activePlatform.id === p.id;
            const dotColor = isActive ? '#30d158' : 'rgba(255,255,255,0.15)';
            const labelColor = isActive ? '#ffffff' : 'rgba(255,255,255,0.40)';
            const fontWeight = isActive ? '500' : '400';

            const btn = document.createElement('button');
            btn.setAttribute('data-mf-nav', p.name);
            btn.style.cssText = 'display:inline-flex;align-items:center;gap:7px;background:transparent;border:none;padding:0;cursor:pointer;color:' + labelColor + ';font-size:13px;font-weight:' + fontWeight + ';font-family:inherit;';

            const dotEl = document.createElement('span');
            dotEl.style.cssText = 'width:6px;height:6px;border-radius:50%;background:' + dotColor + ';display:inline-block;';
            btn.appendChild(dotEl);
            btn.appendChild(document.createTextNode(p.name));
            statusBar.appendChild(btn);
        });

        const flexSpacer = document.createElement('span');
        flexSpacer.style.cssText = 'flex:1;';
        statusBar.appendChild(flexSpacer);

        const filterBtn = document.createElement('button');
        filterBtn.setAttribute('data-mf-back', '1');
        filterBtn.textContent = 'Filter';
        filterBtn.style.cssText = 'background:transparent;border:0.5px solid rgba(255,255,255,0.10);color:rgba(255,255,255,0.55);cursor:pointer;font-size:12px;font-weight:600;padding:5px 12px;border-radius:7px;letter-spacing:0.3px;font-family:inherit;';
        statusBar.appendChild(filterBtn);

        const reloadBtn = document.createElement('button');
        reloadBtn.setAttribute('data-mf-reload', '1');
        reloadBtn.textContent = 'Obnoviť';
        reloadBtn.style.cssText = 'background:transparent;border:none;color:#2fbebe;cursor:pointer;font-size:13px;font-weight:500;padding:0;font-family:inherit;';
        statusBar.appendChild(reloadBtn);

        overlay.dataset.mfActive = sig;

        overlay.onclick = function(e) {
            let t = e.target;
            while (t && t !== overlay) {
                if (t.dataset && (t.dataset.mfNav || t.dataset.mfBack || t.dataset.mfReload)) break;
                t = t.parentElement;
            }
            if (!t || t === overlay) return;

            function injectInstantCurtain() {
                if (document.getElementById('mf-curtain')) return;
                const d = document.createElement('div');
                d.id = 'mf-curtain';
                d.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:#000000;z-index:2147483647;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,sans-serif;transition:opacity 0.8s ease;';
                const html = '<style>@keyframes mf-spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}</style>' +
                    '<div style="width:40px;height:40px;border:4px solid rgba(255,255,255,0.15);border-top:4px solid #4061ad;border-radius:50%;animation:mf-spin 1s linear infinite;margin-bottom:20px;"></div>' +
                    '<h2 style="margin:0;letter-spacing:-0.02em;font-size:24px;color:#ffffff;font-weight:700;">Meshy<span style="font-family:\'Fraunces\',Georgia,serif;font-style:italic;font-weight:600;background:linear-gradient(110deg,#4061ad 0%,#6059a7 45%,#2fbebe 100%);-webkit-background-clip:text;background-clip:text;color:transparent;">Net</span></h2>' +
                    '<p style="color:rgba(255,255,255,0.55);font-size:12px;text-transform:uppercase;letter-spacing:1px;margin-top:8px;font-weight:600;">Načítavanie...</p>';
                if (window.__mfSafeSetHTML) {
                    window.__mfSafeSetHTML(d, html);
                } else {
                    try { d.innerHTML = html; } catch(e) {}
                }
                document.documentElement.appendChild(d);
                document.documentElement.style.overflow = 'hidden';
            }

            function getInvoke() {
                return (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke)
                    || (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke);
            }

            function platformFromHost() {
                const h = window.location.hostname;
                if (h.includes('instagram')) return 'Instagram';
                if (h.includes('youtube')) return 'YouTube';
                return 'Facebook';
            }

            const FALLBACK_URLS = {
                'Facebook': 'https://www.facebook.com',
                'Instagram': 'https://www.instagram.com',
                'YouTube': 'https://www.youtube.com/feed/subscriptions'
            };

            if (t.dataset.mfNav) {
                injectInstantCurtain();
                const network = t.dataset.mfNav;
                const inv = getInvoke();
                if (inv) {
                    inv('otvor_prihlasenie', { network: network }).catch(function(err) {
                        console.warn('[MF] otvor_prihlasenie failed, fallback:', err);
                        window.location.href = FALLBACK_URLS[network] || FALLBACK_URLS.Facebook;
                    });
                } else {
                    window.location.href = FALLBACK_URLS[network] || FALLBACK_URLS.Facebook;
                }
            } else if (t.dataset.mfBack) {
                const backUrl = window.__MF_BACK_URL || 'http://localhost:1420';
                window.location.href = backUrl + '?mode=filter';
            } else if (t.dataset.mfReload) {
                injectInstantCurtain();
                const network = platformFromHost();
                const inv = getInvoke();
                if (inv) {
                    inv('otvor_prihlasenie', { network: network }).catch(function() {
                        window.location.reload();
                    });
                } else {
                    window.location.reload();
                }
            }
        };
    }

    if (isYT) {
        const yta = document.querySelector('ytd-app');
        if (yta && yta.style.paddingTop !== '110px') {
            yta.style.setProperty('padding-top', '110px', 'important');
        }
        if (document.body) {
            document.body.style.setProperty('padding-top', '0', 'important');
        }
    } else {
        if (document.body && document.body.style.paddingTop !== '110px') {
            document.body.style.setProperty('padding-top', '110px', 'important');
        }
    }
})();

if (window.location.hostname.includes('facebook.com')) {

    if (!document.getElementById('masterfeed-zen-style')) {
        const style = document.createElement('style');
        style.id = 'masterfeed-zen-style';
        style.textContent = `
            div[role="banner"], div[role="navigation"], div[role="complementary"],
            div[data-pagelet="LeftRail"], div[data-pagelet="RightRail"] { display: none !important; }
            div[data-pagelet="Stories"], div[aria-label="Príbehy"], div[aria-label="Stories"],
            div[data-pagelet="PageletComposerPostEntity"], div[aria-label="Vytvoriť príspevok"],
            a[aria-label="Vytvoriť príspevok"], div[aria-label="Vytvoriť"], a[aria-label="Vytvoriť"],
            div[aria-label="Create"], div[aria-label="Create post"] { display: none !important; }
            div[aria-label="Reels"], div[aria-label="Reels a krátke videá"],
            div[aria-label="Reels and short videos"],
            div[aria-label="Návrhy vašej skupiny"], div[aria-label="Suggested groups"],
            div[aria-label="Ľudia, ktorých možno poznáte"], div[aria-label="People you may know"]
            { display: none !important; }
            div[role="main"] { margin: 0 auto !important; width: 100% !important; max-width: 650px !important; }
            body { background-color: #f5f5f7 !important; }
            div[data-pagelet="MWChatTabsPagelet"],
            div[aria-label="Chaty"], div[aria-label="Chats"],
            div[aria-label="Messenger"], div[role="dialog"][aria-label*="Messenger"]
            { display: none !important; }
        `;
        document.head.appendChild(style);
    }
const interactLabels = ['Páči sa mi to', 'Komentovať', 'Zdieľať', 'Like', 'Comment', 'Share', 'Zanechajte komentár', 'Reakcie', 'Odoslať'];
    document.querySelectorAll('*').forEach(el => {
        const ariaLabel = el.getAttribute && el.getAttribute('aria-label') || '';
        if (interactLabels.some(label => ariaLabel === label || ariaLabel.includes(label))) {
            let actionBar = el;
            for(let i = 0; i < 4; i++) { if(actionBar.parentElement) actionBar = actionBar.parentElement; }
            if(actionBar) actionBar.style.setProperty('display', 'none', 'important');
        }
        if (['Vytvoriť', 'Create', 'Vytvoriť príspevok', 'Create post'].includes(ariaLabel)) {
            el.style.setProperty('display', 'none', 'important');
        }
    });

    window.__mfFbClean = function() {
        document.querySelectorAll(
            'a[aria-label="Sponzorované"], a[aria-label="Sponsored"], ' +
            'a[aria-label="Reklama"], a[aria-label*="Sponsor"], ' +
            'a[aria-label*="Sponzor"]'
        ).forEach(link => {
            const post = findPostWrapper(link);
            if (post) hideEl(post, 'L1 sponsored aria-label');
        });

        document.querySelectorAll(
            'a[href*="/ads/about"], a[href*="ad_id="], a[href*="ads/preferences"]'
        ).forEach(link => {
            const post = findPostWrapper(link);
            if (post) hideEl(post, 'L1 sponsored href');
        });

        document.querySelectorAll(
            'div[role="article"] span, div[role="article"] div'
        ).forEach(el => {
            if (el.__mfChecked) return;
            el.__mfChecked = true;
            const rect = el.getBoundingClientRect();
            if (rect.height > 30 || rect.width > 250 || rect.width < 20) return;
            const fullText = getFullText(el);
            if (!fullText) return;
            if (/^(Sponzorované|Sponsored|Reklama|Sponsorisé)\s*$/i.test(fullText)) {
                const post = findPostWrapper(el);
                if (post) hideEl(post, 'L2 pseudo-text sponsored');
            }
        });

        document.querySelectorAll('span, div').forEach(el => {
            if (el.__mfPremiumChecked) return;
            if (el.children && el.children.length > 0) return;
            const txt = (el.textContent || '').trim();
            if (txt !== 'Sponzorované' && txt !== 'Sponsored' && txt !== 'Reklama') return;
            el.__mfPremiumChecked = true;
            const link = el.closest('a[aria-label]');
            if (!link) return;
            const al = link.getAttribute('aria-label') || '';
            if (!/Sponzorované|Sponsored|Reklama|Sponsor/i.test(al)) return;
            const post = findPostWrapper(el);
            if (post) hideEl(post, 'L2 premium-format sponsored');
        });

        const followTexts = ['Sledovať', 'Follow', 'Pridať sa', 'Join'];
        document.querySelectorAll('div[role="button"], a[role="button"]').forEach(btn => {
            const txt = (btn.innerText || btn.textContent || '').trim();
            if (!followTexts.includes(txt)) return;
            const post = findPostWrapper(btn);
            if (!post || post.__mfHidden) return;
            const btnRect = btn.getBoundingClientRect();
            const postRect = post.getBoundingClientRect();
            if (postRect.height === 0) return;
            const inHeader = btnRect.top < postRect.top + Math.min(180, postRect.height * 0.35);
            if (inHeader) hideEl(post, 'L3 follow btn in header');
        });

        document.querySelectorAll('div[role="article"]').forEach(post => {
            if (post.__mfHidden) return;
            const text = (post.innerText || '').trim();
            if (!text) return;
            const firstLine = text.split('\n')[0].trim();
            if (/^(Reels|Krátke videá|Short videos|Reels a krátke videá)$/i.test(firstLine)) {
                hideEl(post, 'reels shelf');
            }
        });

        document.querySelectorAll('div[role="article"]').forEach(post => {
            if (post.__mfHidden) return;
            const header = (post.innerText || '').substring(0, 400);
            if (/\bĽudia,?\s+ktorých\s+možno\s+poznáte\b|\bPeople\s+you\s+may\s+know\b/i.test(header)) {
                hideEl(post, 'PYMK text');
            }
            if (/\bNávrhy\s+pre\s+vás\b|\bSuggested\s+for\s+you\b|\bOdporúčané\s+pre\s+vás\b/i.test(header)) {
                hideEl(post, 'Suggested-for-you text');
            }
        });

        document.querySelectorAll(
            '[aria-label="Nová správa"], [aria-label="New message"], ' +
            '[aria-label="Napísať novú správu"], [aria-label="Compose"], ' +
            '[aria-label="Chaty"], [aria-label="Chats"]'
        ).forEach(el => {
            hideEl(el, 'floating compose direct');
            let curr = el;
            for (let i = 0; i < 12; i++) {
                if (!curr.parentElement) break;
                curr = curr.parentElement;
                if (curr.tagName === 'BODY' || curr.tagName === 'HTML') break;
                const st = window.getComputedStyle(curr);
                if (st.position === 'fixed' || st.position === 'absolute' || st.position === 'sticky') {
                    if (!curr.querySelector('[role="main"]') && !curr.querySelector('[role="article"]')) {
                        hideEl(curr, 'floating compose parent');
                        break;
                    }
                }
            }
        });

        const vw = window.innerWidth;
        const vh = window.innerHeight;
        document.querySelectorAll('body *').forEach(el => {
            if (!el || el.__mfHidden) return;
            if (el.id === 'mf-curtain' || (el.closest && el.closest('#mf-curtain'))) return;
            if (el.id === 'mf-overlay' || (el.closest && el.closest('#mf-overlay'))) return;
            const style = window.getComputedStyle(el);
            if (style.position !== 'fixed' && style.position !== 'sticky') return;
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return;
            if (rect.width > vw * 0.75 || rect.height > vh * 0.75) return;
            if (el.querySelector('[role="main"]')) return;
            if (el.querySelector('[role="article"]')) return;
            const inBR = rect.right > vw - 500 && rect.bottom > vh - 400 && rect.bottom <= vh + 50;
            if (!inBR) return;
            if (rect.left < vw * 0.3) return;
            hideEl(el, 'bottom-right widget');
        });
    };

    try { window.__mfFbClean(); } catch(e) { mfLog('clean error', e); }

    if (!window.__mfFbObserver) {
        let scheduled = false;
        window.__mfFbObserver = new MutationObserver(() => {
            if (scheduled) return;
            scheduled = true;
            requestAnimationFrame(() => {
                scheduled = false;
                try { window.__mfFbClean && window.__mfFbClean(); } catch(e) {}
            });
        });
        try {
            window.__mfFbObserver.observe(document.body, {
                childList: true,
                subtree: true
            });
            mfLog('FB MutationObserver active');
        } catch(e) { mfLog('observer setup failed', e); }
    }

    let curtain = document.getElementById('mf-curtain');
    const fbFeedReady = document.querySelector('div[role="feed"] div[role="article"]') ||
                        document.querySelector('div[role="article"]');
    if (curtain && curtain.style.opacity !== '0' && fbFeedReady) {
        curtain.style.opacity = '0';
        document.documentElement.style.overflow = '';
        setTimeout(() => { if(curtain) curtain.remove(); }, 800);
    }
}

else if (window.location.hostname.includes('instagram.com')) {
    document.documentElement.classList.remove('dark', 'theme-dark', '__ig-dark-mode');
    document.body.classList.remove('dark', 'theme-dark', '__ig-dark-mode');

    if (!document.getElementById('masterfeed-zen-style-ig')) {
        const style = document.createElement('style');
        style.id = 'masterfeed-zen-style-ig';
        style.textContent = `
            :root {
                --ig-primary-background: #f5f5f7 !important;
                --ig-secondary-background: #f5f5f7 !important;
                --ig-primary-text: #1d1d1f !important;
                --ig-secondary-text: #86868b !important;
                color-scheme: light !important;
                --feed-sidebar-width: 0px !important;
            }
            html, body, div[id^="mount"], div[id^="mount"] > div, div[id^="mount"] > div > div { background-color: #f5f5f7 !important; }
            main, div[role="main"] { margin: 0 auto !important; max-width: 600px !important; padding-top: 0px !important; background-color: transparent !important; }
            article { background-color: transparent !important; border-bottom: none !important; padding-bottom: 40px !important; margin-bottom: 0px !important; }
            nav, div[role="navigation"], header { display: none !important; width: 0 !important; height: 0 !important; }
            aside, div[role="complementary"] { display: none !important; width: 0 !important; }
            div[data-pagelet="story_tray"] { display: none !important; visibility: hidden !important; height: 0 !important; }
            div[data-pagelet="IGDChatTabsRootContent"] { display: none !important; visibility: hidden !important; opacity: 0 !important; width: 0 !important; height: 0 !important; }
        `;
        document.head.appendChild(style);
    }

    document.querySelectorAll('div, span, a, h1, h2, h3, p').forEach(el => {
        if (el.id === 'mf-curtain' || el.id === 'mf-overlay') return;
        if (el.closest && (el.closest('#mf-curtain') || el.closest('#mf-overlay'))) return;
        if (el.querySelector('img') || el.querySelector('video') || el.querySelector('canvas')) return;
        const style = window.getComputedStyle(el);
        if (style.backgroundColor.startsWith('rgb(0, 0, 0)') || style.backgroundColor.startsWith('rgba(0, 0, 0') || style.backgroundColor === 'rgb(18, 18, 18)' || style.backgroundColor === 'rgb(38, 38, 38)') {
            el.style.setProperty('background-color', 'transparent', 'important');
        }
        if (style.color === 'rgb(255, 255, 255)' || style.color === 'rgb(245, 245, 245)') {
            el.style.setProperty('color', '#1d1d1f', 'important');
        }
    });

    window.__mfIgClean = function() {
        (function() {
            const navIcon = document.querySelector(
                'svg[aria-label="Domov"], svg[aria-label="Home"], ' +
                'svg[aria-label="Filmové pásy"], svg[aria-label="Reels"], ' +
                'svg[aria-label="Hľadať"], svg[aria-label="Search"]'
            );
            if (!navIcon) return;
            let curr = navIcon;
            let killTarget = null;
            const vh = window.innerHeight;
            for (let i = 0; i < 20; i++) {
                if (!curr.parentElement) break;
                curr = curr.parentElement;
                if (curr.tagName === 'BODY' || curr.tagName === 'HTML') break;
                if (curr.querySelector('main') || curr.querySelector('article')) break;
                const rect = curr.getBoundingClientRect();
                if (rect.height >= vh * 0.7 && rect.width < 400) killTarget = curr;
            }
            if (killTarget) {
                killTarget.style.setProperty('display', 'none', 'important');
                killTarget.style.setProperty('width', '0', 'important');
            }
        })();

        (function() {
            const els = document.querySelectorAll('div, span, a');
            for (const el of els) {
                const txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
                if (!txt || txt.length > 60) continue;
                const hasFor = /Pre\s+vás|For\s+you/i.test(txt);
                const hasFollowing = /Sledované|Following/i.test(txt);
                if (hasFor && hasFollowing) {
                    if (el.querySelector('article')) continue;
                    const rect = el.getBoundingClientRect();
                    if (rect.height > 200 || rect.width < 50) continue;
                    el.style.setProperty('display', 'none', 'important');
                    el.style.setProperty('height', '0', 'important');
                }
            }
        })();

        (function() {
            const mainEl = document.querySelector('main');
            if (!mainEl) return;
            Array.from(mainEl.children).forEach(level1 => {
                const innerChildren = Array.from(level1.children);
                if (innerChildren.length < 2) return;
                innerChildren.forEach(child => {
                    if (!child.querySelector('article')) {
                        const rect = child.getBoundingClientRect();
                        if (rect.width < 50 || rect.height < 50) return;
                        const hasFeedSibs = innerChildren.some(c => c !== child && c.querySelector('article'));
                        if (hasFeedSibs) {
                            child.style.setProperty('display', 'none', 'important');
                            child.style.setProperty('width', '0', 'important');
                        }
                    }
                });
            });
            document.querySelectorAll('main > div > div').forEach(container => {
                const children = Array.from(container.children);
                if (children.length < 2) return;
                const feedChild = children.find(c => c.querySelector('article'));
                if (!feedChild) return;
                children.forEach(child => {
                    if (child === feedChild) return;
                    if (child.querySelector('article')) return;
                    const rect = child.getBoundingClientRect();
                    if (rect.width < 100) return;
                    const feedRect = feedChild.getBoundingClientRect();
                    if (rect.left >= feedRect.right - 10) {
                        child.style.setProperty('display', 'none', 'important');
                        child.style.setProperty('width', '0', 'important');
                    }
                });
            });
        })();

        const igInteractLabels = ['Páči sa mi to', 'Komentovať', 'Zdieľať príspevok', 'Like', 'Comment', 'Share Post', 'Uložiť', 'Save'];
        document.querySelectorAll('svg').forEach(svg => {
            const label = svg.getAttribute('aria-label') || '';
            if (igInteractLabels.some(l => label === l || label.includes(l))) {
                let actionBar = svg.closest('section');
                if (actionBar) actionBar.style.setProperty('display', 'none', 'important');
            }
        });

        document.querySelectorAll('article').forEach(article => {
            if (article.__mfHidden) return;
            const headerSpans = article.querySelectorAll('header span, header div, span[role]');
            let isSponsored = false;
            for (const sp of headerSpans) {
                const t = getFullText(sp);
                if (/^(Sponzorované|Sponsored|Reklama)$/i.test(t)) { isSponsored = true; break; }
            }
            if (!isSponsored) {
                const text = (article.innerText || '').replace(/\s/g, '').toLowerCase();
                if (text.includes('sponzorované') || text.includes('sponsored')) isSponsored = true;
            }
            if (isSponsored) hideEl(article, 'IG sponsored');
        });

        const vw = window.innerWidth, vh = window.innerHeight;
        document.querySelectorAll('div[data-pagelet="IGDChatTabsRootContent"]').forEach(el => {
            el.style.setProperty('display', 'none', 'important');
        });
        document.querySelectorAll('body *').forEach(el => {
            if (!el || el.id === 'mf-curtain' || el.id === 'mf-overlay') return;
            if (el.closest && (el.closest('#mf-curtain') || el.closest('#mf-overlay'))) return;
            const style = window.getComputedStyle(el);
            if (style.position !== 'fixed' && style.position !== 'sticky') return;
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return;
            if (rect.width > vw * 0.75 || rect.height > vh * 0.75) return;
            if (el.querySelector('main') || el.querySelector('article')) return;
            const inBR = rect.right > vw - 500 && rect.bottom > vh - 400 && rect.bottom <= vh + 50;
            if (!inBR || rect.left < vw * 0.3) return;
            el.style.setProperty('display', 'none', 'important');
        });

        document.querySelectorAll('div').forEach(el => {
            if (el.id === 'mf-curtain' || el.id === 'mf-overlay') return;
            if (el.closest && (el.closest('#mf-curtain') || el.closest('#mf-overlay'))) return;
            if (el.querySelector('img') || el.querySelector('video') || el.querySelector('canvas')) return;
            const style = window.getComputedStyle(el);
            if (style.borderBottomWidth !== '0px' || style.borderTopWidth !== '0px') {
                el.style.setProperty('border', 'none', 'important');
            }
        });
    };

    try { window.__mfIgClean(); } catch(e) {}

    if (!window.__mfIgObserver) {
        let scheduled = false;
        window.__mfIgObserver = new MutationObserver(() => {
            if (scheduled) return;
            scheduled = true;
            requestAnimationFrame(() => {
                scheduled = false;
                try { window.__mfIgClean && window.__mfIgClean(); } catch(e){}
            });
        });
        try {
            window.__mfIgObserver.observe(document.body, { childList: true, subtree: true });
            mfLog('IG MutationObserver active');
        } catch(e) {}
    }

    let curtain = document.getElementById('mf-curtain');
    if (curtain && curtain.style.opacity !== '0' && document.querySelector('article')) {
        curtain.style.opacity = '0';
        document.documentElement.style.overflow = '';
        setTimeout(() => { if(curtain) curtain.remove(); }, 800);
    }
}

else if (window.location.hostname.includes('youtube.com')) {

    const currPath = window.location.pathname;
    if (currPath === '/' || currPath.startsWith('/feed/trending') ||
        currPath.startsWith('/feed/explore') || currPath.startsWith('/shorts')) {
        window.location.replace('https://www.youtube.com/feed/subscriptions');
    } else {
        document.documentElement.removeAttribute('dark');
        document.documentElement.setAttribute('dark', 'false');

        if (!window.__mfYtNavHook) {
            window.__mfYtNavHook = true;
            document.addEventListener('yt-navigate-finish', function() {
                try {
                    const ov = document.getElementById('mf-overlay');
                    if (ov && ov.parentNode !== document.documentElement) {
                        document.documentElement.appendChild(ov);
                    }
                    const yta = document.querySelector('ytd-app');
                    if (yta) yta.style.setProperty('padding-top', '110px', 'important');
                } catch(e) {}
            }, { passive: true });
            mfLog('YT yt-navigate-finish hook active');
        }

        if (!document.getElementById('masterfeed-zen-style-yt')) {
            const style = document.createElement('style');
            style.id = 'masterfeed-zen-style-yt';
            style.textContent = `
                html, body, ytd-app {
                    background: #f5f5f7 !important;
                    --yt-spec-base-background: #f5f5f7 !important;
                    --yt-spec-raised-background: #ffffff !important;
                    --yt-spec-text-primary: #1d1d1f !important;
                    --yt-spec-text-secondary: #86868b !important;
                    color-scheme: light !important;
                }
                ytd-masthead, #masthead-container, #masthead, tp-yt-app-header,
                tp-yt-app-drawer, #guide, #guide-wrapper, #guide-content,
                ytd-mini-guide-renderer, ytd-guide-renderer, app-drawer,
                ytd-pivot-bar-renderer, [id="mini-guide"],
                ytd-app[mini-guide-visible] #mini-guide,
                yt-page-navigation-progress {
                    display: none !important;
                    width: 0 !important;
                    height: 0 !important;
                    visibility: hidden !important;
                    opacity: 0 !important;
                }
                ytd-app, ytd-app[mini-guide-visible], ytd-app[guide-persistent-and-visible] {
                    --ytd-app-mini-guide-width: 0 !important;
                    --ytd-mini-guide-width: 0 !important;
                }
                ytd-app #page-manager, ytd-page-manager,
                ytd-app[mini-guide-visible] #page-manager {
                    margin-left: 0 !important;
                    margin-top: 0 !important;
                    padding-top: 0 !important;
                }
                ytd-rich-shelf-renderer #title-container,
                ytd-rich-shelf-renderer h2,
                ytd-rich-section-renderer #title,
                ytd-rich-section-renderer h2,
                ytd-shelf-renderer #title-container,
                ytd-shelf-renderer h2,
                ytd-section-list-renderer h2,
                yt-formatted-string#title.ytd-rich-shelf-renderer {
                    display: none !important;
                    height: 0 !important;
                    margin: 0 !important;
                    padding: 0 !important;
                }
                ytd-continuation-item-renderer,
                ytd-show-more-renderer,
                ytd-rich-shelf-renderer #show-more-button,
                ytd-shelf-renderer #show-more-button,
                ytd-button-renderer.ytd-rich-shelf-renderer,
                .yt-spec-button-shape-next[aria-label*="Zobraziť"],
                .yt-spec-button-shape-next[aria-label*="Show more"] {
                    display: none !important;
                }
                ytd-feed-filter-chip-bar-renderer,
                #chips, #chips-wrapper,
                yt-chip-cloud-chip-renderer,
                yt-chip-cloud-renderer,
                [role="tablist"] {
                    display: none !important;
                }
                ytd-ad-slot-renderer, ytd-display-ad-renderer, ytd-promoted-sparkles-web-renderer,
                ytd-promoted-video-renderer, ytd-in-feed-ad-layout-renderer, ytd-banner-promo-renderer,
                ytd-statement-banner-renderer, ytd-action-companion-ad-renderer,
                .ytp-ad-module, .ytp-ad-overlay-container, #player-ads,
                ytd-reel-shelf-renderer, ytd-rich-shelf-renderer[is-shorts],
                ytd-shorts, [is-shorts] {
                    display: none !important;
                }
                ytd-two-column-browse-results-renderer {
                    width: 100% !important; max-width: 650px !important; margin: 0 auto !important;
                    display: block !important; justify-content: center !important;
                }
                #primary { max-width: 650px !important; margin: 0 auto !important; padding: 0 !important; }
                #secondary, ytd-watch-next-secondary-results-renderer, #related {
                    display: none !important;
                }
                ytd-rich-grid-renderer {
                    --ytd-rich-grid-items-per-row: 1 !important;
                    --ytd-rich-grid-item-min-width: 100% !important;
                    --ytd-rich-grid-item-max-width: 650px !important;
                }
                ytd-rich-grid-row {
                    display: block !important;
                    justify-content: center !important;
                }
                ytd-rich-grid-row #contents {
                    display: block !important;
                }
                ytd-rich-item-renderer {
                    margin: 0 auto 30px !important;
                    width: 100% !important;
                    max-width: 650px !important;
                    display: block !important;
                }
                ytd-rich-shelf-renderer {
                    margin-bottom: 0 !important;
                    padding-bottom: 0 !important;
                }
                ytd-rich-shelf-renderer #contents {
                    display: block !important;
                }
            `;
            document.head.appendChild(style);
        }

        const ytHideSelectors = [
            'ytd-masthead', '#masthead-container', '#masthead', 'tp-yt-app-header',
            'tp-yt-app-drawer', '#guide', '#guide-wrapper', '#guide-content',
            'ytd-mini-guide-renderer', 'ytd-guide-renderer', 'app-drawer',
            'ytd-pivot-bar-renderer', '#mini-guide',
            'ytd-feed-filter-chip-bar-renderer', '#chips', '#chips-wrapper',
            'yt-chip-cloud-renderer', 'yt-chip-cloud-chip-renderer',
            'ytd-continuation-item-renderer', 'ytd-show-more-renderer',
            'ytd-rich-shelf-renderer #title', 'ytd-rich-shelf-renderer #title-container',
            'ytd-rich-section-renderer #title',
            'ytd-rich-shelf-renderer h2', 'ytd-rich-section-renderer h2',
            'ytd-shelf-renderer h2',
            'ytd-ad-slot-renderer', 'ytd-display-ad-renderer',
            'ytd-promoted-video-renderer', 'ytd-in-feed-ad-layout-renderer',
            'ytd-reel-shelf-renderer',
            '#secondary',
        ];
        ytHideSelectors.forEach(sel => {
            try {
                document.querySelectorAll(sel).forEach(el => {
                    el.style.setProperty('display', 'none', 'important');
                    el.style.setProperty('width', '0', 'important');
                    el.style.setProperty('height', '0', 'important');
                });
            } catch(e) {}
        });

        const ytApp = document.querySelector('ytd-app');
        if (ytApp) {
            ytApp.style.setProperty('padding-top', '110px', 'important');
            ytApp.removeAttribute('mini-guide-visible');
            ytApp.removeAttribute('guide-persistent-and-visible');
        }
        if (document.body) {
            document.body.style.setProperty('padding-top', '0', 'important');
            document.body.style.setProperty('margin-top', '0', 'important');
        }

        document.querySelectorAll('ytd-rich-grid-row').forEach(row => {
            row.style.setProperty('display', 'block', 'important');
        });
        document.querySelectorAll('ytd-rich-grid-row #contents').forEach(c => {
            c.style.setProperty('display', 'block', 'important');
        });
        document.querySelectorAll('ytd-rich-item-renderer').forEach(item => {
            item.style.setProperty('display', 'block', 'important');
            item.style.setProperty('width', '100%', 'important');
            item.style.setProperty('max-width', '650px', 'important');
            item.style.setProperty('margin', '0 auto 30px', 'important');
        });

        const skipBtn = document.querySelector('.ytp-ad-skip-button, .ytp-skip-ad-button, .ytp-ad-skip-button-modern');
        if (skipBtn) skipBtn.click();
        const adShowing = document.querySelector('.ad-showing, .ytp-ad-player-overlay');
        if (adShowing) {
            const video = document.querySelector('video.html5-main-video');
            if (video && video.duration && isFinite(video.duration)) {
                video.currentTime = video.duration;
                video.playbackRate = 16;
            }
        }

        let curtain = document.getElementById('mf-curtain');
        const feedReady = document.querySelector('ytd-rich-grid-renderer ytd-rich-item-renderer') ||
                          document.querySelector('#primary.ytd-watch-flexy') ||
                          document.querySelector('ytd-channel-renderer');
        if (curtain && curtain.style.opacity !== '0' && feedReady) {
            curtain.style.opacity = '0';
            document.documentElement.style.overflow = '';
            setTimeout(() => { if(curtain) curtain.remove(); }, 800);
        }
    }
}
"#;
#[command]
async fn otvor_prihlasenie(app: AppHandle, network: String) -> Result<(), String> {
    let url_str = match network.as_str() {
        "Facebook"  => "https://www.facebook.com",
        "YouTube"   => "https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2Ffeed%2Fsubscriptions",
        _           => "https://www.instagram.com",
    };

    let url = url_str.parse().map_err(|_| "Chyba URL")?;

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.eval(PRE_NAVIGATE_CURTAIN);
        thread::sleep(Duration::from_millis(60));

        window.navigate(url).map_err(|e| e.to_string())?;

        let w_init = window.clone();
        thread::spawn(move || {
            let init_script = r#"
                (function() {
                    if (window.__mfConsoleOverrideDone) return;
                    window.__mfConsoleOverrideDone = true;
                    var oL = console.log, oW = console.warn, oE = console.error;
                    var bl = [/self.?xss/i, /selfxss/i, /Stop!/, /funkcia prehliadača určená pre vývojárov/i, /This is a browser feature intended for developers/i];
                    var ok = function(a) { var s = [].slice.call(a).map(function(x) { return typeof x === 'string' ? x : ''; }).join(' '); return !bl.some(function(p) { return p.test(s); }); };
                    console.log = function() { if (ok(arguments)) oL.apply(console, arguments); };
                    console.warn = function() { if (ok(arguments)) oW.apply(console, arguments); };
                    console.error = function() { if (ok(arguments)) oE.apply(console, arguments); };
                })();
                if (!window.__mfTrustedPolicy && window.trustedTypes && window.trustedTypes.createPolicy) {
                    try {
                        window.__mfTrustedPolicy = window.trustedTypes.createPolicy('mf-policy', {
                            createHTML: function(s) { return s; }
                        });
                    } catch(e) {}
                }
                if (!window.__mfSafeSetHTML) {
                    window.__mfSafeSetHTML = function(el, html) {
                        if (window.__mfTrustedPolicy) {
                            try { el.innerHTML = window.__mfTrustedPolicy.createHTML(html); return true; } catch(e) {}
                        }
                        try { el.innerHTML = html; return true; } catch(e) {}
                        return false;
                    };
                }

                if(document.documentElement && !document.getElementById('mf-curtain')) {
                    let d = document.createElement('div');
                    d.id = 'mf-curtain';
                    d.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:#000000;z-index:2147483647;display:flex;flex-direction:column;align-items:center;justify-content:center;transition:opacity 0.8s ease;font-family:\'Manrope\',-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;';
                    window.__mfSafeSetHTML(d, '<style>@keyframes mf-spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}</style><div style="width:40px;height:40px;border:4px solid rgba(255,255,255,0.15);border-top:4px solid #4061ad;border-radius:50%;animation:mf-spin 1s linear infinite;margin-bottom:20px;"></div><h2 style="margin:0;letter-spacing:-0.02em;font-size:24px;color:#ffffff;font-weight:700;font-family:\'Manrope\',sans-serif;">Meshy<span style="font-family:\'Fraunces\',Georgia,serif;font-style:italic;font-weight:600;background:linear-gradient(110deg,#4061ad 0%,#6059a7 45%,#2fbebe 100%);-webkit-background-clip:text;background-clip:text;color:transparent;">Net</span></h2><p style="color:rgba(255,255,255,0.55);font-size:12px;text-transform:uppercase;letter-spacing:1px;margin-top:8px;font-weight:600;">Načítavanie...</p>');
                    document.documentElement.appendChild(d);
                    document.documentElement.style.overflow = 'hidden';
                }
            "#;

            let back_url = if cfg!(debug_assertions) {
                "http://localhost:1420"
            } else {
                "tauri://localhost"
            };
            let url_inject = format!("window.__MF_BACK_URL = '{}';", back_url);
            let _ = w_init.eval(&url_inject);

            for _ in 0..100 {
                let _ = w_init.eval(init_script);
                thread::sleep(Duration::from_millis(25));
            }
        });

        if !MF_ZEN_LOOP_STARTED.swap(true, Ordering::SeqCst) {
            let w_zen = window.clone();
            thread::spawn(move || {
                loop {
                    let zen_script: &str = ZEN_SCRIPT_CACHE
                        .get()
                        .map(|s| s.as_str())
                        .unwrap_or(ZEN_SCRIPT_FALLBACK);

                    if let Err(e) = w_zen.eval(zen_script) {
                        eprintln!("[MF] zen_script eval failed (continuing): {:?}", e);
                    }
                    thread::sleep(Duration::from_secs(2));
                }
            });
        }
    }

    Ok(())
}
// ============================================================
// 🕵️ HTTP-based scraping (no webview, no CSP, no JS lifecycle)
// ============================================================

#[command]
async fn mf_scrape_profile(
    app: AppHandle,
    network: String,
    profile_name: String,
    source_id: String,
) -> Result<(), String> {
    println!("[MF] mf_scrape_profile (HTTP): network={}, profile={}", network, profile_name);

    let app_clone = app.clone();
    let network_clone = network.clone();
    let profile_name_clone = profile_name.clone();
    let source_id_clone = source_id.clone();

    thread::spawn(move || {
        let result = match network_clone.as_str() {
            "Facebook"  => scrape_facebook(&profile_name_clone),
            "Instagram" => scrape_instagram(&profile_name_clone),
            "YouTube"   => scrape_youtube(&profile_name_clone),
            _ => {
                eprintln!("[MF] Unknown network: {}", network_clone);
                Vec::new()
            }
        };

        println!("[MF] ✅ {} ({}) → {} posts",
            profile_name_clone, network_clone, result.len());

        if let Some(main_window) = app_clone.get_webview_window("main") {
            let payload = serde_json::json!({
                "network": network_clone,
                "sourceId": source_id_clone,
                "posts": result,
            });
            if let Err(e) = main_window.emit("mf-scraped-posts", payload) {
                eprintln!("[MF] Emit failed: {}", e);
            }
        }
    });

    Ok(())
}

fn http_client() -> Option<reqwest::blocking::Client> {
    reqwest::blocking::Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15")
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .ok()
}

// Enriches posts that lack imageUrl by fetching OG metadata from any external
// article link found in the post body. Applied sequentially with a 200ms gap
// between fetches to avoid hammering news sites.
fn enrich_posts_with_og(posts: &mut Vec<JsonValue>) {
    let mut first_fetch = true;
    for (i, post) in posts.iter_mut().enumerate() {
        let body = post.get("body")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        // Check "externalUrl" (set by FB attachment parser) first, then scan body text
        let ext_url_attach = post.get("externalUrl")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(String::from);
        let ext_url = ext_url_attach.or_else(|| og_metadata::extract_external_url(&body));

        let has_image = post.get("imageUrl")
            .and_then(|v| v.as_str())
            .map(|s| !s.is_empty())
            .unwrap_or(false);
        // Body is "junk" when, stripped of all URLs, almost nothing
        // meaningful remains (e.g. "Čítajte viac: https://…").
        let stripped_len = og_metadata::strip_urls(&body).trim().chars().count();
        let body_is_junk = stripped_len < 40;
        let skip_url = ext_url.as_deref().map(og_metadata::should_skip).unwrap_or(false);

        eprintln!(
            "[MF OG DEBUG] post #{} has_image={} body_is_junk={} stripped_len={} skip_url={} extracted_url={:?} body_first_80={:?}",
            i, has_image, body_is_junk, stripped_len, skip_url, ext_url,
            body.chars().take(80).collect::<String>()
        );

        let ext_url = match ext_url {
            Some(u) => u,
            None => continue,
        };
        if skip_url {
            continue;
        }

        // OG only adds value if the image is missing or the body is junk.
        if has_image && !body_is_junk {
            continue;
        }

        if !first_fetch {
            std::thread::sleep(Duration::from_millis(200));
        }
        first_fetch = false;

        let og = match og_metadata::fetch_og(&ext_url) {
            Ok(m) => m,
            Err(_) => continue,
        };

        let obj = match post.as_object_mut() {
            Some(o) => o,
            None => continue,
        };

        // Don't clobber an already-scraped link-card image.
        if !has_image {
            if let Some(img) = og.image {
                obj.insert("imageUrl".to_string(), JsonValue::String(img));
            }
        }

        if body_is_junk {
            if let Some(better) = og.title.or(og.description) {
                obj.insert("body".to_string(), JsonValue::String(better));
            }
        }
    }
}

// Extracts an external article URL from the FB JSON attachment context window.
// FB stores the clean canonical URL in an ExternalWebLink; the l.php redirect
// is a (double-encoded) fallback.
fn extract_fb_attachment_url(html: &str) -> Option<String> {
    // FB double-encodes the l.php target: each '%' of the percent-encoding is
    // itself JSON-escaped as %, so `%2F` arrives as `%2F`. Decoding
    // % -> % first turns those back into ordinary %2F / %3A sequences.
    let normalized: String = html
        .replace("\\u0025", "%")
        .replace("\\u002F", "/")
        .replace("\\u002f", "/")
        .replace("\\/", "/");

    let take_url = |after: &str| -> Option<String> {
        let end = after
            .find(|c: char| c == '"' || c.is_whitespace() || c == '\\')
            .unwrap_or(after.len().min(800));
        let url = &after[..end];
        if (url.starts_with("https://") || url.starts_with("http://"))
            && url.len() > 12
            && !og_metadata::should_skip(url)
        {
            Some(url.to_string())
        } else {
            None
        }
    };

    // Priority 1: FB's ExternalWebLink carries the clean canonical article URL.
    // (Search the whole window — the link data often sits BEFORE the
    // "attachments":[{ marker, so narrowing by marker would skip it.)
    if let Some(wl) = normalized.find("\"web_link\":{") {
        let seg = &normalized[wl..(wl + 1500).min(normalized.len())];
        if let Some(u) = seg.find("\"url\":\"") {
            if let Some(found) = take_url(&seg[u + 7..]) {
                return Some(found);
            }
        }
    }

    // Priority 2: first plain "url":"http(s)://<external>" anywhere in window.
    let mut s = 0usize;
    while let Some(rel) = normalized[s..].find("\"url\":\"http") {
        let p = s + rel + "\"url\":\"".len();
        if let Some(found) = take_url(&normalized[p..]) {
            return Some(found);
        }
        s = p;
    }

    // Priority 3 (last resort): l.facebook.com/l.php?u=<percent-encoded>
    if let Some(pos) = normalized.find("l.facebook.com/l.php?u=") {
        let after = &normalized[pos + "l.facebook.com/l.php?u=".len()..];
        let end = after.find(|c: char| matches!(c, '&' | '"' | '\'' | ' ' | '\n' | '\r' | '\\'))
            .unwrap_or(after.len().min(600));
        let decoded = url_decode_pct(&after[..end]);
        if decoded.starts_with("https://") && !og_metadata::should_skip(&decoded) {
            return Some(decoded);
        }
    }

    None
}

fn url_decode_pct(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h), Some(l)) = (hex_digit(bytes[i + 1]), hex_digit(bytes[i + 2])) {
                out.push((h * 16 + l) as char);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i] as char);
        i += 1;
    }
    out
}

fn hex_digit(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

// HTTP klient pre mbasic.facebook.com — text-only mobilná verzia, server-rendered.
// Pre anonymné requesty je to jediný spôsob ako dostať VIAC ako 1 post.
fn http_client_mbasic() -> Option<reqwest::blocking::Client> {
    reqwest::blocking::Client::builder()
        .user_agent("Mozilla/5.0 (Linux; U; Android 4.4.2; en-us; SCH-I535 Build/KOT49H) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30")
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .ok()
}

// ====================================================================
// FACEBOOK — viacstupňová stratégia
//   1) mbasic.facebook.com (najlepšie, 5-10 postov)
//   2) www.facebook.com (fallback, 1-3 posty)
//   3) OG meta tags snapshot (last resort)
// ====================================================================

fn scrape_facebook(profile_name: &str) -> Vec<JsonValue> {
    println!("[MF FB] === Starting Facebook scrape for '{}' ===", profile_name);

    let mut posts: Vec<JsonValue> = if let Some(client) = http_client_mbasic() {
        let candidates = casing_variants(profile_name);
        let mut mbasic_posts: Vec<JsonValue> = Vec::new();
        for candidate in candidates.iter() {
            let p = scrape_fb_mbasic(&client, candidate);
            if p.len() >= 2 {
                println!("[MF FB] ✅ mbasic returned {} posts for '{}'",
                    p.len(), candidate);
                mbasic_posts = p;
                break;
            } else if !p.is_empty() {
                println!("[MF FB] mbasic only {} post(s) for '{}', trying www",
                    p.len(), candidate);
            }
        }
        if mbasic_posts.is_empty() {
            println!("[MF FB] mbasic exhausted, falling back to www.facebook.com");
            scrape_facebook_www(profile_name)
        } else {
            mbasic_posts
        }
    } else {
        scrape_facebook_www(profile_name)
    };

    // ── OG metadata enrichment for posts without images ──────────────
    enrich_posts_with_og(&mut posts);

    // ── Inline FB CDN images (rieši hotlink protection) ─────────────
    if !posts.is_empty() {
        if let Some(client) = http_client() {
            let referer = format!("https://www.facebook.com/{}", profile_name);
            let mut converted = 0usize;
            let mut failed = 0usize;
            for post in posts.iter_mut() {
                for field in &["imageUrl", "videoThumbUrl"] {
                    let current = post.get(*field)
                        .and_then(|v| v.as_str())
                        .map(String::from);
                    let Some(url) = current else { continue; };
                    if url.is_empty() || url.starts_with("data:") { continue; }
                    match fetch_as_data_url(&client, &url, &referer) {
                        Some(data_url) => {
                            post[*field] = JsonValue::String(data_url);
                            converted += 1;
                        }
                        None => {
                            failed += 1;
                        }
                    }
                }
            }
            println!("[MF FB] Inlined images: {} ok, {} failed", converted, failed);
        }
    }

    posts
}

// --- mbasic.facebook.com scraping ----------------------------------

fn scrape_fb_mbasic(
    client: &reqwest::blocking::Client,
    profile_name: &str,
) -> Vec<JsonValue> {
    let url = format!("https://mbasic.facebook.com/{}", profile_name);
    println!("[MF FB-mbasic] GET {}", url);

    let html = match client.get(&url)
        .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
        .header("Accept-Language", "en-US,en;q=0.9,sk;q=0.8")
        .header("Upgrade-Insecure-Requests", "1")
        .header("Cache-Control", "no-cache")
        .send()
        .and_then(|r| r.text())
    {
        Ok(t) => t,
        Err(e) => {
            eprintln!("[MF FB-mbasic] HTTP error: {}", e);
            return Vec::new();
        }
    };

    println!("[MF FB-mbasic] HTML size: {} bytes", html.len());

    if html.len() < 2000 {
        println!("[MF FB-mbasic] Response too small — likely error/redirect");
        return Vec::new();
    }

    let lower_preview: String = html.chars().take(20_000).collect::<String>().to_lowercase();
    let login_signals = [
        "you must log in",
        "musíte sa prihlásiť",
        "log in to facebook",
        "prihláste sa do facebook",
    ];
    let has_login_signal = login_signals.iter().any(|s| lower_preview.contains(s));
    if has_login_signal && html.len() < 15_000 {
        println!("[MF FB-mbasic] Login wall detected");
        return Vec::new();
    }

    let mut posts = parse_fb_mbasic_html(&html, profile_name);

    for (i, post) in posts.iter_mut().enumerate() {
        if let Some(obj) = post.as_object_mut() {
            obj.insert(
                "id".to_string(),
                JsonValue::String(format!("fb-{}-{}", profile_name, i)),
            );
        }
    }

    posts
}

fn parse_fb_mbasic_html(html: &str, profile_name: &str) -> Vec<JsonValue> {
    let mut posts: Vec<JsonValue> = Vec::new();
    let mut seen_keys: std::collections::HashSet<String> = std::collections::HashSet::new();

    parse_mbasic_articles(html, profile_name, &mut posts, &mut seen_keys);
    println!("[MF FB-mbasic] After <article> pass: {} posts", posts.len());

    if posts.len() < 2 {
        parse_mbasic_data_ft(html, profile_name, &mut posts, &mut seen_keys);
        println!("[MF FB-mbasic] After data-ft pass: {} posts", posts.len());
    }

    posts
}

fn parse_mbasic_articles(
    html: &str,
    profile_name: &str,
    posts: &mut Vec<JsonValue>,
    seen_keys: &mut std::collections::HashSet<String>,
) {
    let mut search = 0usize;

    while let Some(rel) = html[search..].find("<article") {
        let pos = search + rel;
        let after = &html[pos..];

        let tag_end = match after.find('>') {
            Some(i) => i,
            None => break,
        };

        let body_start = pos + tag_end + 1;
        let close_pos = match html[body_start..].find("</article>") {
            Some(i) => body_start + i,
            None => break,
        };

        let inner = &html[body_start..close_pos];
        let opening_tag = &after[..tag_end];

        process_mbasic_post(inner, opening_tag, profile_name, posts, seen_keys);

        if posts.len() >= 10 { return; }
        search = close_pos + 10;
    }
}

fn parse_mbasic_data_ft(
    html: &str,
    profile_name: &str,
    posts: &mut Vec<JsonValue>,
    seen_keys: &mut std::collections::HashSet<String>,
) {
    let mut search = 0usize;

    while let Some(rel) = html[search..].find("data-ft=\"") {
        let pos = search + rel;

        let scan_back = pos.saturating_sub(300);
        let scan = &html[scan_back..pos];
        let div_start = match scan.rfind("<div") {
            Some(i) => scan_back + i,
            None => {
                search = pos + 10;
                continue;
            }
        };

        let div_open_end = match html[div_start..].find('>') {
            Some(i) => div_start + i + 1,
            None => break,
        };

        let next_data_ft_offset = html[div_open_end..]
            .find("data-ft=\"")
            .unwrap_or(30_000);
        let max_close = (div_open_end + next_data_ft_offset.min(30_000)).min(html.len());

        let close_pos = match html[div_open_end..max_close].find("</div>") {
            Some(i) => div_open_end + i,
            None => {
                search = pos + 10;
                continue;
            }
        };

        let inner = &html[div_open_end..close_pos];
        let opening = &html[div_start..div_open_end];

        process_mbasic_post(inner, opening, profile_name, posts, seen_keys);

        if posts.len() >= 10 { return; }
        search = close_pos + 6;
    }
}

fn process_mbasic_post(
    inner_html: &str,
    opening_tag: &str,
    profile_name: &str,
    posts: &mut Vec<JsonValue>,
    seen_keys: &mut std::collections::HashSet<String>,
) {
    let opening_lower = opening_tag.to_lowercase();
    if opening_lower.contains("\"is_sponsored\":true")
        || opening_lower.contains("sponsored")
    {
        return;
    }
    let inner_lower = inner_html.to_lowercase();
    if inner_lower.contains(">sponsored<")
        || inner_lower.contains(">sponzorované<")
        || inner_lower.contains(">reklama<")
    {
        return;
    }

    let raw_text = strip_html_tags_to_text(inner_html);
    let body = clean_mbasic_body(&raw_text);

    if body.len() < 15 {
        return;
    }

    if is_mbasic_ui_text(&body) {
        return;
    }

    let key = fb_dedup_key(&body);
    if seen_keys.contains(&key) {
        return;
    }
    seen_keys.insert(key);

    let image = extract_mbasic_image(inner_html);
    let permalink = extract_mbasic_permalink(inner_html, profile_name);

    let body_capped = if body.len() > 800 {
        body.chars().take(800).collect::<String>()
    } else {
        body
    };

    let preview: String = body_capped.chars().take(60).collect();
    println!("[MF FB-mbasic] post '{}…' → img={}", preview, image.is_some());

    let fb_ts = extract_fb_timestamp(inner_html);
    let published = fb_ts.map(epoch_to_iso).unwrap_or_else(chrono_iso_now);
    #[cfg(debug_assertions)]
    println!(
        "[MF FB TS] post={:?} extracted_ts={:?} -> {}",
        body_capped.chars().take(40).collect::<String>(),
        fb_ts,
        published
    );

    posts.push(serde_json::json!({
        "id": format!("fb-{}-{}", profile_name, posts.len()),
        "body": body_capped,
        "imageUrl": image,
        "videoThumbUrl": null,
        "permalink": permalink,
        "publishedAt": published,
    }));
}

fn strip_html_tags_to_text(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut in_tag = false;
    let mut prev_space = false;

    for c in html.chars() {
        if c == '<' {
            in_tag = true;
            if !prev_space && !out.is_empty() {
                out.push(' ');
                prev_space = true;
            }
            continue;
        }
        if c == '>' && in_tag {
            in_tag = false;
            continue;
        }
        if in_tag { continue; }

        if c.is_whitespace() {
            if !prev_space {
                out.push(' ');
                prev_space = true;
            }
        } else {
            out.push(c);
            prev_space = false;
        }
    }

    html_decode(out.trim())
}

fn clean_mbasic_body(s: &str) -> String {
    let trimmed = s.trim().to_string();

    let cut_markers = [
        "Like · Comment · Share",
        "Like Comment Share",
        "Páči sa mi to · Komentovať · Zdieľať",
        "Páči sa mi to Komentovať Zdieľať",
        "Full Story",
        "Celý príbeh",
        "View Full Post",
        "Show More",
        "See More",
        "See Translation",
        "Pozrieť preklad",
    ];

    let mut result = trimmed;
    for marker in &cut_markers {
        if let Some(idx) = result.find(marker) {
            result.truncate(idx);
            result = result.trim().to_string();
        }
    }

    if result.len() > 50 {
        let tail_window = result.len().saturating_sub(80);
        let tail = &result[tail_window..];
        for needle in &[" Like Reply ", " Páči sa mi Odpovedať "] {
            if let Some(rel) = tail.find(needle) {
                let cut_at = tail_window + rel;
                result.truncate(cut_at);
                result = result.trim().to_string();
                break;
            }
        }
    }

    result.trim().to_string()
}

fn is_mbasic_ui_text(s: &str) -> bool {
    let lower = s.to_lowercase();
    let ui_markers = [
        "log in to facebook",
        "create new account",
        "sign up for facebook",
        "you must log in",
        "page not found",
        "this page isn't available",
        "musíte sa prihlásiť",
        "stránka sa nenašla",
        "cookie policy",
        "zásady používania súborov cookie",
    ];
    for m in &ui_markers {
        if lower.contains(m) {
            return true;
        }
    }
    if s.len() < 30 && !s.chars().any(|c| c.is_alphabetic()) {
        return true;
    }
    false
}

fn extract_mbasic_image(html: &str) -> Option<String> {
    let mut search = 0usize;
    while let Some(rel) = html[search..].find("src=\"") {
        let pos = search + rel + 5;
        let after = &html[pos..];
        let end = match after.find('"') {
            Some(i) => i,
            None => return None,
        };
        let url_raw = &after[..end];
        let url = html_decode(url_raw).replace("&amp;", "&");
        let lower = url.to_lowercase();

        let is_fb_image = (lower.contains("fbcdn") || lower.contains("scontent"))
            && (lower.contains(".jpg")
                || lower.contains(".jpeg")
                || lower.contains(".png")
                || lower.contains(".webp")
                || lower.contains(".gif"));
        let is_avatar = lower.contains("/t39.30808-1/");
        let is_emoji_or_static = lower.contains("emoji.php")
            || lower.contains("/rsrc.php/")
            || lower.contains("static.xx.fbcdn");

        if is_fb_image && !is_avatar && !is_emoji_or_static {
            return Some(url);
        }

        search = pos + end;
    }
    None
}

fn extract_mbasic_permalink(html: &str, profile_name: &str) -> String {
    let patterns = [
        format!("/{}/posts/", profile_name),
        format!("/{}/photos/", profile_name),
        "/story.php?story_fbid=".to_string(),
        "/permalink.php?story_fbid=".to_string(),
    ];

    for pat in &patterns {
        if let Some(pos) = html.find(pat.as_str()) {
            let scan_start = pos.saturating_sub(150);
            let scan = &html[scan_start..pos];
            if let Some(href_pos) = scan.rfind("href=\"") {
                let url_start = scan_start + href_pos + 6;
                let after = &html[url_start..];
                if let Some(end) = after.find('"') {
                    let cleaned = html_decode(&after[..end]).replace("&amp;", "&");
                    if cleaned.starts_with("http") {
                        return cleaned.replace("mbasic.facebook.com", "www.facebook.com");
                    } else if cleaned.starts_with('/') {
                        return format!("https://www.facebook.com{}", cleaned);
                    }
                }
            }
        }
    }

    format!("https://www.facebook.com/{}", profile_name)
}
// --- www.facebook.com scraping (fallback) -----------------

fn scrape_facebook_www(profile_name: &str) -> Vec<JsonValue> {
    let client = match http_client() {
        Some(c) => c,
        None => return Vec::new(),
    };

    let candidates = casing_variants(profile_name);
    let path_variants = ["/posts/", "", "/photos", "/videos"];

    let mut all_posts: Vec<JsonValue> = Vec::new();
    let mut all_keys: std::collections::HashSet<String> = std::collections::HashSet::new();

    let mut og_image_for_fallback: Option<String> = None;
    let mut og_desc_for_fallback: Option<String> = None;
    let mut canonical_candidate: String = candidates[0].clone();
    let mut any_valid_html = false;

    'outer: for candidate in candidates.iter() {
        for path in &path_variants {
            let url = format!("https://www.facebook.com/{}{}", candidate, path);
            println!("[MF FB-www] GET {}", url);

            let html = match client.get(&url)
                .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
                .header("Accept-Language", "en-US,en;q=0.9,sk;q=0.8")
                .header("Sec-Fetch-Dest", "document")
                .header("Sec-Fetch-Mode", "navigate")
                .header("Sec-Fetch-Site", "none")
                .send()
                .and_then(|r| r.text())
            {
                Ok(t) => t,
                Err(e) => {
                    eprintln!("[MF FB-www] HTTP error: {}", e);
                    continue;
                }
            };

            println!("[MF FB-www] HTML len: {} bytes (variant: {}{})",
                html.len(), candidate, path);

            if html.len() < 50_000 {
                let preview: String = html.chars().take(200).collect();
                println!("[MF FB-www] ⚠ Small HTML — variant rejected. Preview: {}", preview);
                continue;
            }

            any_valid_html = true;

            if og_image_for_fallback.is_none() {
                og_image_for_fallback = find_meta_content(&html, "og:image");
                og_desc_for_fallback = find_meta_content(&html, "og:description");
                canonical_candidate = candidate.clone();
                if let Some(ref m) = og_image_for_fallback {
                    if let Some(b) = extract_fb_image_basename(m) {
                        println!("[MF FB-www] Page avatar basename to exclude: {}", b);
                    }
                }
            }

            let page_avatar_marker = og_image_for_fallback.as_deref()
                .and_then(extract_fb_image_basename);

            let posts_from_url =
                parse_fb_messages_json(&html, candidate, page_avatar_marker.as_deref());
            println!("[MF FB-www] Parsed {} posts from {}{}",
                posts_from_url.len(), candidate, path);

            for post in posts_from_url {
                let body = post.get("body").and_then(|v| v.as_str()).unwrap_or("");
                let key = fb_dedup_key(body);
                if !all_keys.contains(&key) {
                    all_keys.insert(key);
                    all_posts.push(post);
                    if all_posts.len() >= 10 { break 'outer; }
                }
            }
        }

        // Pokračuj cez candidates len ak máme < 5 postov — chceme viac postov
        if all_posts.len() >= 5 {
            break;
        }
    }

    if !all_posts.is_empty() {
        for (i, post) in all_posts.iter_mut().enumerate() {
            if let Some(obj) = post.as_object_mut() {
                obj.insert(
                    "id".to_string(),
                    JsonValue::String(format!("fb-{}-{}", canonical_candidate, i)),
                );
            }
        }
        println!("[MF FB-www] ✅ Final post count after multi-URL union: {}", all_posts.len());
        return all_posts;
    }

    if any_valid_html && (og_image_for_fallback.is_some() || og_desc_for_fallback.is_some()) {
        println!("[MF FB-www] OG fallback active");
        return vec![serde_json::json!({
            "id": format!("fb-{}-profile", canonical_candidate),
            "body": og_desc_for_fallback.unwrap_or_default(),
            "imageUrl": og_image_for_fallback,
            "videoThumbUrl": null,
            "permalink": format!("https://www.facebook.com/{}", canonical_candidate),
            "publishedAt": chrono_iso_now(),
        })];
    }

    Vec::new()
}

fn casing_variants(name: &str) -> Vec<String> {
    let mut out = vec![name.to_string()];

    let mut chars = name.chars();
    if let Some(first) = chars.next() {
        let cap: String = first.to_uppercase().collect::<String>() + chars.as_str();
        if cap != name && !out.contains(&cap) {
            out.push(cap);
        }
    }

    let lower = name.to_lowercase();
    if lower != name && !out.contains(&lower) {
        out.push(lower);
    }

    out
}

fn fb_dedup_key(s: &str) -> String {
    s.chars()
        .filter(|c| !c.is_whitespace())
        .flat_map(|c| c.to_lowercase())
        .take(80)
        .collect()
}

fn parse_fb_messages_json(
    html: &str,
    profile_name: &str,
    exclude_avatar_basename: Option<&str>,
) -> Vec<JsonValue> {
    let mut posts: Vec<JsonValue> = Vec::new();
    let mut seen_texts: Vec<String> = Vec::new();
    let mut seen_keys: Vec<String> = Vec::new();

    let patterns = [
        r#""message":{"text":""#,
        r#""body":{"text":""#,
        r#""description":{"text":""#,
        r#""story":{"message":{"text":""#,
        r#""attached_story":{"message":{"text":""#,
        r#""creation_story":{"comet_sections":{"message":{"story":{"message":{"text":""#,
        r#""comet_sections":{"content":{"story":{"message":{"text":""#,
        r#""content":{"story":{"message":{"text":""#,
    ];

    for pattern in &patterns {
        let mut search_start = 0usize;
        let mut prev_after_msg = 0usize;
        while let Some(rel_pos) = html[search_start..].find(pattern) {
            let pos = search_start + rel_pos;
            let after = &html[pos + pattern.len()..];

            let mut end_idx: Option<usize> = None;
            let bytes = after.as_bytes();
            let mut i = 0;
            while i < bytes.len() && i < 30_000 {
                if bytes[i] == b'\\' {
                    i += 2;
                    continue;
                }
                if bytes[i] == b'"' {
                    end_idx = Some(i);
                    break;
                }
                i += 1;
            }

            let Some(end) = end_idx else {
                search_start = pos + pattern.len();
                continue;
            };

            let raw_text = &after[..end];
            let decoded = decode_json_string(raw_text);
            let trimmed = decoded.trim().to_string();

            if trimmed.len() < 15 {
                search_start = pos + pattern.len() + end;
                continue;
            }

            let key = fb_dedup_key(&trimmed);
            let mut is_dup = false;
            let mut replace_idx: Option<usize> = None;
            for (existing_idx, existing_key) in seen_keys.iter().enumerate() {
                if existing_key == &key {
                    if trimmed.len() > seen_texts[existing_idx].len() {
                        replace_idx = Some(existing_idx);
                    } else {
                        is_dup = true;
                    }
                    break;
                }
            }
            if is_dup {
                search_start = pos + pattern.len() + end;
                continue;
            }

            let after_msg = pos + pattern.len() + end;
            let basic_msg_marker = "\"message\":{\"text\":\"";
            let next_msg_offset = html[after_msg..]
                .find(basic_msg_marker)
                .unwrap_or(50_000);
            // Clamp the backward look so it can't bleed into the previous
            // post's media block and steal its image.
            let img_window_start = pos.saturating_sub(10_000).max(prev_after_msg);
            let img_window_end = (after_msg + next_msg_offset).min(html.len());
            let img_window = &html[img_window_start..img_window_end];
            let nearby_image = find_fb_image(img_window, exclude_avatar_basename);
            let nearby_present = nearby_image.is_some();
            prev_after_msg = after_msg;

            let extended_end = (after_msg + 60_000).min(html.len());
            let extended_window = &html[after_msg..extended_end];
            let (link_img, link_title) =
                find_fb_attachment_data(extended_window, exclude_avatar_basename);
            let attach_url = extract_fb_attachment_url(extended_window);

            println!(
                "[MF FB ATTACH] post #{} url={:?} title={:?}",
                posts.len(),
                attach_url.as_deref().map(|u| &u[..u.len().min(80)]),
                link_title.as_deref(),
            );

            let body_preview = trimmed.chars().take(60).collect::<String>();
            let image_url = nearby_image.as_ref().or(link_img.as_ref()).cloned();

            #[cfg(debug_assertions)]
            eprintln!(
                "[MF FB-POST] msg_pos={} after_msg={} next_msg_offset={} \
                 img_win=[{}..{}] ext_win=[{}..{}] \
                 nearby={:?} link={:?} chosen={:?} body_preview={:?}",
                pos, after_msg, next_msg_offset,
                img_window_start, img_window_end,
                after_msg, extended_end,
                nearby_image.as_deref().map(|s| &s[..s.len().min(120)]),
                link_img.as_deref().map(|s| &s[..s.len().min(120)]),
                image_url.as_deref().map(|s| &s[..s.len().min(120)]),
                body_preview,
            );

            let body_with_title = match &link_title {
                Some(t) if !trimmed.contains(t.as_str())
                       && !t.contains(trimmed.as_str())
                       && !t.is_empty() => {
                    format!("{}\n\n{}", trimmed, t)
                }
                _ => trimmed.clone(),
            };

            let body_capped = if body_with_title.len() > 800 {
                body_with_title.chars().take(800).collect::<String>()
            } else {
                body_with_title.clone()
            };

            let img_source = if nearby_present {
                "nearby"
            } else if image_url.is_some() {
                "attachment"
            } else {
                "none"
            };
            let preview: String = trimmed.chars().take(60).collect();
            println!(
                "[MF FB-www] post '{}…' → img={} (source: {}), title={}",
                preview,
                image_url.is_some(),
                img_source,
                link_title.is_some()
            );

            let fb_ts = extract_fb_timestamp(img_window);
            let published = fb_ts.map(epoch_to_iso).unwrap_or_else(chrono_iso_now);
            #[cfg(debug_assertions)]
            println!(
                "[MF FB TS] post={:?} extracted_ts={:?} -> {}",
                trimmed.chars().take(40).collect::<String>(),
                fb_ts,
                published
            );

            let new_post = serde_json::json!({
                "id": format!("fb-{}-{}", profile_name, posts.len()),
                "body": body_capped,
                "imageUrl": image_url,
                "videoThumbUrl": null,
                "permalink": format!("https://www.facebook.com/{}", profile_name),
                "publishedAt": published,
                "externalUrl": attach_url,
            });

            if let Some(ridx) = replace_idx {
                seen_texts[ridx] = trimmed.clone();
                seen_keys[ridx] = key;
                if let Some(slot) = posts.get_mut(ridx) {
                    *slot = new_post;
                }
            } else {
                seen_texts.push(trimmed.clone());
                seen_keys.push(key);
                posts.push(new_post);
            }

            if posts.len() >= 10 { return posts; }

            search_start = pos + pattern.len() + end;
        }
    }

    posts
}

fn find_fb_image(html: &str, exclude_avatar_basename: Option<&str>) -> Option<String> {
    let normalized: String = html
        .replace("\\u002F", "/")
        .replace("\\u002f", "/")
        .replace("\\/", "/");

    let mut candidates: Vec<String> = Vec::new();
    let mut search = 0usize;

    while let Some(rel) = normalized[search..].find("https://") {
        let pos = search + rel;
        let after = &normalized[pos..];

        let mut end = 0usize;
        for (i, c) in after.char_indices() {
            if c == '"' || c == ' ' || c == '<' || c == '>' || c == ')'
                || c == '\\' || c == '\n' || c == '\r' || c == '\t'
            {
                end = i;
                break;
            }
            if i > 2000 { end = i; break; }
        }

        let advance_to = if end >= 30 { pos + end } else { pos + 8 };

        if end < 30 {
            search = advance_to;
            continue;
        }

        let url_raw = &after[..end];
        let cleaned = url_raw
            .replace("\\u0026", "&")
            .replace("&amp;", "&");
        let lower = cleaned.to_lowercase();

        let is_fb_cdn = lower.contains("fbcdn.net")
            || lower.contains("scontent")
            || lower.contains("fbsbx.com")
            || lower.contains("lookaside.fbsbx.com");
        if !is_fb_cdn {
            search = advance_to;
            continue;
        }

        let has_ext = lower.contains(".jpg")
            || lower.contains(".jpeg")
            || lower.contains(".png")
            || lower.contains(".webp")
            || lower.contains(".gif");
        let is_safe_image = lower.contains("safe_image.php")
            || lower.contains("/safe_image")
            || lower.contains("lookaside.fbsbx.com");
        if !has_ext && !is_safe_image {
            search = advance_to;
            continue;
        }

        if lower.contains("/t39.30808-1/") {
            search = advance_to;
            continue;
        }

        let is_tiny = lower.contains("/emoji.php")
            || lower.contains("p32x32") || lower.contains("p48x48")
            || lower.contains("p60x60") || lower.contains("p80x80")
            || lower.contains("s32x32") || lower.contains("s48x48")
            || lower.contains("s60x60") || lower.contains("s80x80");
        if is_tiny {
            search = advance_to;
            continue;
        }

        let matches_page_avatar = exclude_avatar_basename
            .and_then(|excl| extract_fb_image_basename(&cleaned).map(|b| b == excl))
            .unwrap_or(false);
        if matches_page_avatar {
            search = advance_to;
            continue;
        }

        if !candidates.contains(&cleaned) {
            candidates.push(cleaned);
        }

        search = advance_to;
    }

    candidates.into_iter().next()
}

fn find_fb_attachment_data(
    html: &str,
    exclude_avatar_basename: Option<&str>,
) -> (Option<String>, Option<String>) {
    let title = extract_fb_link_title(html);

    let attachment_markers = [
        "\"attached_story_attachment\"",
        "\"styles\":\"share\"",
        "\"story_attachment_style\":\"share\"",
        "\"link_preview\":{",
        "\"share_attachment\":",
        "\"attachments\":[{",
    ];
    let mut earliest: Option<usize> = None;
    for m in &attachment_markers {
        if let Some(p) = html.find(m) {
            earliest = Some(match earliest {
                Some(e) => e.min(p),
                None => p,
            });
        }
    }

    let image = if let Some(marker_pos) = earliest {
        // Rozšírený scan window — link card images bývajú ďalej za markerom
        let ctx_end = (marker_pos + 25_000).min(html.len());
        let ctx = &html[marker_pos..ctx_end];
        find_fb_link_card_image(ctx, exclude_avatar_basename)
            .or_else(|| find_fb_image(ctx, exclude_avatar_basename))
    } else {
        find_fb_link_card_image(html, exclude_avatar_basename)
            .or_else(|| find_fb_image(html, exclude_avatar_basename))
    };

    println!(
        "[MF FB] attachment scan — marker_at={:?}, image_found={}, title_found={}",
        earliest,
        image.is_some(),
        title.is_some()
    );

    (image, title)
}

fn extract_fb_link_title(html: &str) -> Option<String> {
    let patterns = [
        r#""title_with_entities":{"text":""#,
        r#""share_attachment_title":{"text":""#,
        r#""attachment_title":{"text":""#,
    ];
    for pat in &patterns {
        if let Some(p) = html.find(pat) {
            let after = &html[p + pat.len()..];
            let bytes = after.as_bytes();
            let mut e = 0usize;
            let mut i = 0;
            while i < bytes.len() && i < 1000 {
                if bytes[i] == b'\\' { i += 2; continue; }
                if bytes[i] == b'"' { e = i; break; }
                i += 1;
            }
            if e > 5 {
                let decoded = decode_json_string(&after[..e]);
                let trimmed = decoded.trim().to_string();
                if !trimmed.is_empty() && trimmed.len() < 500 {
                    return Some(trimmed);
                }
            }
        }
    }
    None
}

fn find_fb_link_card_image(
    html: &str,
    exclude_avatar_basename: Option<&str>,
) -> Option<String> {
    let normalized: String = html
        .replace("\\u002F", "/")
        .replace("\\u002f", "/")
        .replace("\\/", "/");

    let mut search = 0usize;
    while let Some(rel) = normalized[search..].find("https://") {
        let pos = search + rel;
        let after = &normalized[pos..];

        let mut end = 0usize;
        for (i, c) in after.char_indices() {
            if c == '"' || c == ' ' || c == '<' || c == '>' || c == ')'
                || c == '\\' || c == '\n' || c == '\r' || c == '\t'
            {
                end = i;
                break;
            }
            if i > 2000 { end = i; break; }
        }

        let advance_to = if end >= 30 { pos + end } else { pos + 8 };
        if end < 30 {
            search = advance_to;
            continue;
        }

        let url_raw = &after[..end];
        let cleaned = url_raw
            .replace("\\u0026", "&")
            .replace("&amp;", "&");
        let lower = cleaned.to_lowercase();

        // Pokrýva oba FB CDN host varianty:
        //   external-bts2-1.xx.fbcdn.net  (starý, s pomlčkou)
        //   external.fbts7-1.fna.fbcdn.net (nový, s bodkou — SME a iné media outlety)
        let is_link_card = lower.contains("external-")
            || lower.contains("external.")
            || lower.contains("/external")
            || lower.contains("safe_image.php")
            || lower.contains("lookaside.fbsbx.com");
        if !is_link_card {
            search = advance_to;
            continue;
        }

        let has_ext = lower.contains(".jpg")
            || lower.contains(".jpeg")
            || lower.contains(".png")
            || lower.contains(".webp")
            || lower.contains(".gif");
        let is_safe_image = lower.contains("safe_image.php");
        if !has_ext && !is_safe_image {
            search = advance_to;
            continue;
        }

        if lower.contains("/t39.30808-1/") {
            search = advance_to;
            continue;
        }

        let is_tiny = lower.contains("p32x32") || lower.contains("p48x48")
            || lower.contains("p60x60") || lower.contains("p80x80")
            || lower.contains("s32x32") || lower.contains("s48x48")
            || lower.contains("s60x60") || lower.contains("s80x80");
        if is_tiny {
            search = advance_to;
            continue;
        }

        let matches_page_avatar = exclude_avatar_basename
            .and_then(|excl| extract_fb_image_basename(&cleaned).map(|b| b == excl))
            .unwrap_or(false);
        if matches_page_avatar {
            search = advance_to;
            continue;
        }

        return Some(cleaned);
    }

    None
}

fn extract_fb_image_basename(url: &str) -> Option<String> {
    let no_query = url.split('?').next().unwrap_or(url);
    let basename = no_query.rsplit('/').next()?;
    if basename.len() < 8 || !basename.contains('.') {
        return None;
    }
    Some(basename.to_string())
}

fn decode_json_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some('n') => out.push('\n'),
                Some('t') => out.push('\t'),
                Some('r') => out.push('\r'),
                Some('"') => out.push('"'),
                Some('\\') => out.push('\\'),
                Some('/') => out.push('/'),
                Some('u') => {
                    let hex: String = chars.by_ref().take(4).collect();
                    if let Ok(code) = u32::from_str_radix(&hex, 16) {
                        if let Some(ch) = char::from_u32(code) {
                            out.push(ch);
                        }
                    }
                }
                Some(other) => {
                    out.push('\\');
                    out.push(other);
                }
                None => break,
            }
        } else {
            out.push(c);
        }
    }
    out
}
// ====================================================================
// INSTAGRAM
// ====================================================================

fn scrape_instagram(profile_name: &str) -> Vec<JsonValue> {
    let client = match http_client() {
        Some(c) => c,
        None => return Vec::new(),
    };

    let mut posts: Vec<JsonValue> = Vec::new();

    let api_url = format!(
        "https://www.instagram.com/api/v1/users/web_profile_info/?username={}",
        profile_name
    );
    println!("[MF IG] API GET {}", api_url);

    let api_resp = client.get(&api_url)
        .header("X-IG-App-ID", "936619743392459")
        .header("Accept", "*/*")
        .header("Accept-Language", "en-US,en;q=0.9,sk;q=0.8")
        .header("Sec-Fetch-Dest", "empty")
        .header("Sec-Fetch-Mode", "cors")
        .header("Sec-Fetch-Site", "same-origin")
        .header("Referer", &format!("https://www.instagram.com/{}/", profile_name))
        .send();

    if let Ok(resp) = api_resp {
        let status = resp.status();
        match resp.text() {
            Ok(text) => {
                println!("[MF IG] API status={}, body_len={}", status, text.len());
                if status.is_success() && text.len() > 100 {
                    let api_posts = parse_ig_api_response(&text, profile_name);
                    if !api_posts.is_empty() {
                        println!("[MF IG] ✅ API succeeded: {} posts", api_posts.len());
                        posts = api_posts;
                    } else {
                        println!("[MF IG] API returned but no posts parsed");
                    }
                }
            }
            Err(e) => eprintln!("[MF IG] API body read error: {}", e),
        }
    } else if let Err(e) = api_resp {
        eprintln!("[MF IG] API request error: {}", e);
    }

    if posts.is_empty() {
        let url = format!("https://www.instagram.com/{}/", profile_name);
        println!("[MF IG] HTML fallback GET {}", url);

        let html = client.get(&url)
            .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
            .header("Accept-Language", "en-US,en;q=0.9")
            .header("Sec-Fetch-Dest", "document")
            .header("Sec-Fetch-Mode", "navigate")
            .header("Sec-Fetch-Site", "none")
            .send()
            .and_then(|r| r.text())
            .unwrap_or_else(|e| {
                eprintln!("[MF IG] HTTP error: {}", e);
                String::new()
            });

        if !html.is_empty() {
            println!("[MF IG] HTML length: {} bytes", html.len());

            posts = parse_ig_posts(&html, profile_name);
            println!("[MF IG] Parsed {} posts from HTML payloads", posts.len());

            if posts.is_empty() {
                let og_image = find_meta_content(&html, "og:image");
                let og_description = find_meta_content(&html, "og:description");
                let og_title = find_meta_content(&html, "og:title");

                let body = match (og_description, og_title) {
                    (Some(d), _) if !d.is_empty() => d,
                    (_, Some(t)) => t,
                    _ => String::new(),
                };

                if og_image.is_some() || !body.is_empty() {
                    println!("[MF IG] OG fallback active (img={}, body_len={})",
                        og_image.is_some(), body.len());
                    posts.push(serde_json::json!({
                        "id": format!("ig-{}-profile", profile_name),
                        "body": body,
                        "imageUrl": og_image,
                        "videoThumbUrl": null,
                        "permalink": format!("https://www.instagram.com/{}/", profile_name),
                        "publishedAt": chrono_iso_now(),
                    }));
                }
            }
        }
    }

    // ── OG metadata enrichment for posts without images ──────────────
    enrich_posts_with_og(&mut posts);

    if !posts.is_empty() {
        let referer = format!("https://www.instagram.com/{}/", profile_name);
        let mut converted = 0usize;
        let mut failed = 0usize;
        for post in posts.iter_mut() {
            for field in &["imageUrl", "videoThumbUrl"] {
                let current = post.get(*field)
                    .and_then(|v| v.as_str())
                    .map(String::from);
                let Some(url) = current else { continue; };
                if url.is_empty() || url.starts_with("data:") { continue; }
                match fetch_as_data_url(&client, &url, &referer) {
                    Some(data_url) => {
                        post[*field] = JsonValue::String(data_url);
                        converted += 1;
                    }
                    None => {
                        failed += 1;
                    }
                }
            }
        }
        println!("[MF IG] Inlined images: {} ok, {} failed", converted, failed);
    }

    posts
}

fn parse_ig_api_response(json_text: &str, profile_name: &str) -> Vec<JsonValue> {
    let root: JsonValue = match serde_json::from_str(json_text) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("[MF IG] API JSON parse error: {}", e);
            return Vec::new();
        }
    };

    let edges = root
        .get("data")
        .and_then(|d| d.get("user"))
        .and_then(|u| u.get("edge_owner_to_timeline_media"))
        .and_then(|m| m.get("edges"))
        .and_then(|e| e.as_array());

    let edges = match edges {
        Some(e) => e,
        None => {
            eprintln!("[MF IG] API: chýbajú edges (možno súkromný profil alebo neexistuje)");
            return Vec::new();
        }
    };

    println!("[MF IG] API edges count: {}", edges.len());

    let mut posts = Vec::new();
    for (idx, edge) in edges.iter().enumerate().take(10) {
        let node = match edge.get("node") {
            Some(n) => n,
            None => continue,
        };

        let shortcode = node.get("shortcode").and_then(|v| v.as_str()).unwrap_or("");
        if shortcode.is_empty() { continue; }

        let display_url = node.get("display_url").and_then(|v| v.as_str()).map(String::from);
        let thumb_src = node.get("thumbnail_src").and_then(|v| v.as_str()).map(String::from);
        let image_url = display_url.clone().or(thumb_src.clone());

        let is_video = node.get("is_video").and_then(|v| v.as_bool()).unwrap_or(false);

        println!(
            "[MF IG] post[{}] shortcode={} is_video={} display_url={} thumb_src={}",
            idx,
            shortcode,
            is_video,
            display_url.is_some(),
            thumb_src.is_some(),
        );

        let caption = node
            .get("edge_media_to_caption")
            .and_then(|c| c.get("edges"))
            .and_then(|e| e.as_array())
            .and_then(|arr| arr.first())
            .and_then(|first| first.get("node"))
            .and_then(|n| n.get("text"))
            .and_then(|t| t.as_str())
            .map(String::from)
            .unwrap_or_default();

        let body_capped = if caption.len() > 800 {
            caption.chars().take(800).collect::<String>()
        } else {
            caption
        };

        let video_thumb = if is_video { image_url.clone() } else { None };
        let final_image = if is_video { None } else { image_url };

        let published = node
            .get("taken_at_timestamp")
            .and_then(|v| v.as_u64())
            .map(epoch_to_iso)
            .unwrap_or_else(chrono_iso_now);

        posts.push(serde_json::json!({
            "id": format!("ig-{}-{}", profile_name, shortcode),
            "body": body_capped,
            "imageUrl": final_image,
            "videoThumbUrl": video_thumb,
            "permalink": format!("https://www.instagram.com/p/{}/", shortcode),
            "publishedAt": published,
        }));
    }

    posts
}

fn parse_ig_posts(html: &str, profile_name: &str) -> Vec<JsonValue> {
    let mut posts: Vec<JsonValue> = Vec::new();
    let mut seen_shortcodes: std::collections::HashSet<String> = std::collections::HashSet::new();

    let shortcode_pat = r#""shortcode":""#;
    let mut search_start = 0usize;

    while let Some(rel_pos) = html[search_start..].find(shortcode_pat) {
        let pos = search_start + rel_pos;
        let after = &html[pos + shortcode_pat.len()..];

        let mut sc_end = 0usize;
        for (i, c) in after.char_indices() {
            if c == '"' { sc_end = i; break; }
            if i > 50 { break; }
        }
        if sc_end < 5 || sc_end > 30 {
            search_start = pos + shortcode_pat.len();
            continue;
        }
        let shortcode = after[..sc_end].to_string();

        if seen_shortcodes.contains(&shortcode) {
            search_start = pos + shortcode_pat.len() + sc_end;
            continue;
        }
        seen_shortcodes.insert(shortcode.clone());

        let window_end = (pos + 8000).min(html.len());
        let window = &html[pos..window_end];

        let image_url = extract_ig_field(window, "\"display_url\":\"")
            .or_else(|| extract_ig_field(window, "\"thumbnail_src\":\""))
            .or_else(|| extract_ig_field(window, "\"thumbnail_url\":\""))
            .map(|raw| raw.replace("\\/", "/").replace("\\u0026", "&"));

        let caption_pat = r#""edge_media_to_caption":{"edges":[{"node":{"text":""#;
        let caption = window.find(caption_pat).and_then(|cp| {
            let from = cp + caption_pat.len();
            let after_cap = &window[from..];
            let mut e = 0usize;
            let bytes = after_cap.as_bytes();
            let mut i = 0;
            while i < bytes.len() && i < 5000 {
                if bytes[i] == b'\\' { i += 2; continue; }
                if bytes[i] == b'"' { e = i; break; }
                i += 1;
            }
            if e > 0 {
                Some(decode_json_string(&after_cap[..e]))
            } else { None }
        });

        let caption2 = caption.or_else(|| {
            let p2 = r#""caption":{"text":""#;
            window.find(p2).and_then(|cp| {
                let from = cp + p2.len();
                let after_cap = &window[from..];
                let mut e = 0usize;
                let bytes = after_cap.as_bytes();
                let mut i = 0;
                while i < bytes.len() && i < 5000 {
                    if bytes[i] == b'\\' { i += 2; continue; }
                    if bytes[i] == b'"' { e = i; break; }
                    i += 1;
                }
                if e > 0 {
                    Some(decode_json_string(&after_cap[..e]))
                } else { None }
            })
        });

        let body_text = caption2
            .map(|t| {
                if t.len() > 800 {
                    t.chars().take(800).collect::<String>()
                } else {
                    t
                }
            })
            .unwrap_or_default();

        if image_url.is_none() && body_text.is_empty() {
            search_start = pos + shortcode_pat.len() + sc_end;
            continue;
        }

        let permalink = format!("https://www.instagram.com/p/{}/", shortcode);

        posts.push(serde_json::json!({
            "id": format!("ig-{}-{}", profile_name, shortcode),
            "body": body_text,
            "imageUrl": image_url,
            "videoThumbUrl": null,
            "permalink": permalink,
            "publishedAt": chrono_iso_now(),
        }));

        if posts.len() >= 10 { break; }
        search_start = pos + shortcode_pat.len() + sc_end;
    }

    posts
}

fn extract_ig_field(window: &str, pattern: &str) -> Option<String> {
    let p = window.find(pattern)?;
    let after = &window[p + pattern.len()..];
    let mut e = 0usize;
    let bytes = after.as_bytes();
    let mut i = 0;
    while i < bytes.len() && i < 2000 {
        if bytes[i] == b'\\' && i + 1 < bytes.len() && bytes[i + 1] != b'"' {
            i += 2;
            continue;
        }
        if bytes[i] == b'"' && (i == 0 || bytes[i - 1] != b'\\') {
            e = i;
            break;
        }
        i += 1;
    }
    if e > 5 { Some(after[..e].to_string()) } else { None }
}

// ====================================================================
// YOUTUBE — RSS feed
// ====================================================================

fn scrape_youtube(profile_name: &str) -> Vec<JsonValue> {
    let client = match http_client() {
        Some(c) => c,
        None => return Vec::new(),
    };

    let handle = if profile_name.starts_with('@') {
        profile_name.to_string()
    } else {
        format!("@{}", profile_name)
    };

    let candidate_urls = [
        format!("https://www.youtube.com/{}/videos", handle),
        format!("https://www.youtube.com/{}", handle),
        format!("https://www.youtube.com/c/{}", profile_name.trim_start_matches('@')),
        format!("https://www.youtube.com/user/{}", profile_name.trim_start_matches('@')),
    ];

    let mut channel_id: Option<String> = None;

    for url in &candidate_urls {
        if channel_id.is_some() { break; }
        println!("[MF YT] GET {}", url);

        let html = match client.get(url)
            .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
            .header("Accept-Language", "en-US,en;q=0.9,sk;q=0.8")
            .send()
            .and_then(|r| r.text())
        {
            Ok(t) => t,
            Err(e) => {
                eprintln!("[MF YT] HTTP error for {}: {}", url, e);
                continue;
            }
        };

        if html.len() < 5000 {
            println!("[MF YT] Small HTML for {}: {} bytes — skipping", url, html.len());
            continue;
        }

        let cid_candidates = [
            find_meta_content(&html, "channelId"),
            scan_for_uc_id(&html, "\"channelId\":\""),
            scan_for_uc_id(&html, "\"externalId\":\""),
            scan_for_uc_id(&html, "\"browseId\":\""),
            extract_canonical_channel_id(&html),
        ];

        for c in cid_candidates.into_iter().flatten() {
            if c.starts_with("UC") && c.len() >= 20 && c.len() <= 30 {
                channel_id = Some(c);
                break;
            }
        }
    }

    let cid = match channel_id {
        Some(c) => {
            println!("[MF YT] Resolved channel ID: {}", c);
            c
        }
        None => {
            eprintln!("[MF YT] Could not find channel ID for {}", profile_name);
            return Vec::new();
        }
    };

    let rss_url = format!("https://www.youtube.com/feeds/videos.xml?channel_id={}", cid);
    println!("[MF YT] Fetching RSS: {}", rss_url);
    let rss = match client.get(&rss_url)
        .header("Accept", "application/atom+xml,application/xml,text/xml")
        .send()
        .and_then(|r| r.text())
    {
        Ok(t) => t,
        Err(e) => {
            eprintln!("[MF YT] RSS fetch error: {}", e);
            return Vec::new();
        }
    };

    let posts = parse_youtube_rss(&rss, profile_name);
    println!("[MF YT] Parsed {} videos from RSS", posts.len());
    posts
}

fn scan_for_uc_id(html: &str, needle: &str) -> Option<String> {
    let mut search_start = 0usize;
    while let Some(rel) = html[search_start..].find(needle) {
        let pos = search_start + rel;
        let after = &html[pos + needle.len()..];
        if let Some(end) = after.find('"') {
            let val = &after[..end];
            if val.starts_with("UC") && val.len() >= 20 && val.len() <= 30 {
                return Some(val.to_string());
            }
        }
        search_start = pos + needle.len();
    }
    None
}

fn extract_canonical_channel_id(html: &str) -> Option<String> {
    let needle = "https://www.youtube.com/channel/";
    let pos = html.find(needle)?;
    let after = &html[pos + needle.len()..];
    let mut end = 0usize;
    for (i, c) in after.char_indices() {
        if !c.is_ascii_alphanumeric() && c != '_' && c != '-' {
            end = i;
            break;
        }
    }
    if end >= 20 && end <= 30 {
        Some(after[..end].to_string())
    } else {
        None
    }
}

fn parse_youtube_rss(xml: &str, profile_name: &str) -> Vec<JsonValue> {
    let mut posts = Vec::new();
    let mut search = xml;
    let mut idx = 0;

    while let Some(entry_start) = search.find("<entry>") {
        let after = &search[entry_start + 7..];
        let entry_end = match after.find("</entry>") {
            Some(i) => i,
            None => break,
        };
        let entry = &after[..entry_end];

        let title = extract_xml_tag(entry, "title").unwrap_or_default();
        let link = {
            let needle = "<link rel=\"alternate\" href=\"";
            entry.find(needle).and_then(|p| {
                let a = &entry[p + needle.len()..];
                a.find('"').map(|e| a[..e].to_string())
            }).unwrap_or_default()
        };
        let video_id = extract_xml_tag(entry, "yt:videoId").unwrap_or_default();
        let published = extract_xml_tag(entry, "published").unwrap_or_else(|| chrono_iso_now());
        let thumb_url = if !video_id.is_empty() {
            Some(format!("https://i.ytimg.com/vi/{}/hqdefault.jpg", video_id))
        } else {
            None
        };

        posts.push(serde_json::json!({
            "id": format!("yt-{}-{}", profile_name, idx),
            "body": title,
            "imageUrl": null,
            "videoThumbUrl": thumb_url,
            "permalink": link,
            "publishedAt": published,
        }));

        idx += 1;
        if posts.len() >= 10 { break; }
        search = &after[entry_end + 8..];
    }

    posts
}
// ====================================================================
// HTML/XML helpers
// ====================================================================

fn html_decode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '&' {
            out.push(c);
            continue;
        }
        let mut entity = String::new();
        let mut found_semi = false;
        for _ in 0..12 {
            match chars.peek() {
                Some(&';') => { chars.next(); found_semi = true; break; }
                Some(_) => { entity.push(chars.next().unwrap()); }
                None => break,
            }
        }
        if !found_semi {
            out.push('&');
            out.push_str(&entity);
            continue;
        }
        let decoded: Option<char> = match entity.as_str() {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            "nbsp" => Some(' '),
            s if s.starts_with("#x") || s.starts_with("#X") => {
                u32::from_str_radix(&s[2..], 16).ok().and_then(char::from_u32)
            }
            s if s.starts_with('#') => {
                s[1..].parse::<u32>().ok().and_then(char::from_u32)
            }
            _ => None,
        };
        match decoded {
            Some(ch) => out.push(ch),
            None => {
                out.push('&');
                out.push_str(&entity);
                out.push(';');
            }
        }
    }
    out
}

fn find_meta_content(html: &str, name: &str) -> Option<String> {
    let patterns = [
        format!("property=\"{}\"", name),
        format!("name=\"{}\"", name),
        format!("itemprop=\"{}\"", name),
    ];
    for pat in &patterns {
        if let Some(pos) = html.find(pat.as_str()) {
            let scan_start = pos.saturating_sub(200);
            let scan_end = (pos + 300).min(html.len());
            let scan = &html[scan_start..scan_end];
            if let Some(c_pos) = scan.find("content=\"") {
                let after = &scan[c_pos + 9..];
                if let Some(end) = after.find('"') {
                    return Some(html_decode(&after[..end]));
                }
            }
        }
    }
    None
}

fn extract_xml_tag(xml: &str, tag: &str) -> Option<String> {
    let open = format!("<{}>", tag);
    let close = format!("</{}>", tag);
    let pos = xml.find(&open)?;
    let after = &xml[pos + open.len()..];
    let end = after.find(&close)?;
    Some(html_decode(&after[..end]))
}

fn epoch_to_iso(epoch_secs: u64) -> String {
    let secs_in_day: u64 = 86_400;
    let days_since_epoch = epoch_secs / secs_in_day;
    let secs_today = epoch_secs % secs_in_day;
    let hour = secs_today / 3600;
    let minute = (secs_today % 3600) / 60;
    let second = secs_today % 60;

    let mut days = days_since_epoch as i64;
    let mut year: i64 = 1970;
    loop {
        let leap = (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0);
        let dy = if leap { 366 } else { 365 };
        if days < dy { break; }
        days -= dy;
        year += 1;
    }
    let leap = (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0);
    let mdays: [i64; 12] = [31, if leap {29} else {28}, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let mut month = 1i64;
    for &m in mdays.iter() {
        if days < m { break; }
        days -= m;
        month += 1;
    }
    let day = days + 1;

    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.000Z",
        year, month, day, hour, minute, second)
}

fn chrono_iso_now() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    epoch_to_iso(now)
}

// Extracts a real post timestamp (unix epoch seconds) from FB JSON.
// Tries "creation_time": then "publish_time": — first occurrence in the
// (post-scoped) window wins, which also covers the nested creation_story case.
fn extract_fb_timestamp(html: &str) -> Option<u64> {
    for key in &["\"creation_time\":", "\"publish_time\":"] {
        if let Some(p) = html.find(key) {
            let after = &html[p + key.len()..];
            let digits: String = after
                .chars()
                .take_while(|c| c.is_ascii_digit())
                .collect();
            if let Ok(ts) = digits.parse::<u64>() {
                if ts > 1_000_000_000 {
                    return Some(ts);
                }
            }
        }
    }
    None
}

// ============================================================
// 🎫 Backend status — tier + limits
// ============================================================

#[command]
async fn mf_get_status(access_token: String) -> Result<JsonValue, String> {
    let has_token = !access_token.is_empty();
    println!("[MF] mf_get_status: fetching from backend... (has_token={})", has_token);

    let token_opt: Option<String> = if has_token { Some(access_token) } else { None };

    let result = tokio::task::spawn_blocking(move || {
        backend::fetch_status(token_opt.as_deref())
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?;

    match result {
        Ok(status) => {
            println!(
                "[MF] mf_get_status OK: tier={}, max_profiles_per_platform={}",
                status.status.tier, status.status.max_profiles_per_platform
            );
            serde_json::to_value(status).map_err(|e| e.to_string())
        }
        Err(e) => {
            eprintln!("[MF] mf_get_status FAILED: {}", e);
            Err(e)
        }
    }
}

// ============================================================
// Device registration + status check
// ============================================================

#[derive(serde::Serialize, serde::Deserialize, Debug)]
pub struct DeviceInfo {
    pub device_id: String,
    pub device_name: String,
    pub device_kind: String, // "desktop" | "mobile"
    pub os: String,
}

#[tauri::command]
fn mf_get_device_info() -> Result<DeviceInfo, String> {
    let device_id = machine_uid::get()
        .map_err(|e| format!("Failed to read machine UID: {}", e))?;

    let hostname = std::process::Command::new("hostname")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Unknown Device".to_string());

    let os_name = std::env::consts::OS;

    let os_version = {
        #[cfg(target_os = "macos")]
        {
            std::process::Command::new("sw_vers")
                .arg("-productVersion")
                .output()
                .ok()
                .and_then(|o| String::from_utf8(o.stdout).ok())
                .map(|s| s.trim().to_string())
                .unwrap_or_else(|| "unknown".to_string())
        }
        #[cfg(not(target_os = "macos"))]
        {
            "unknown".to_string()
        }
    };

    Ok(DeviceInfo {
        device_id,
        device_name: format!("{} ({})", hostname, os_name),
        device_kind: "desktop".to_string(),
        os: format!("{} {}", os_name, os_version),
    })
}

#[tauri::command]
async fn mf_register_device(
    jwt: String,
    supabase_url: String,
    supabase_anon_key: String,
) -> Result<serde_json::Value, String> {
    let info = mf_get_device_info()?;
    let client = reqwest::Client::new();
    let url = format!("{}/rest/v1/rpc/register_device", supabase_url);

    let body = serde_json::json!({
        "p_device_id":   info.device_id,
        "p_device_name": info.device_name,
        "p_device_kind": info.device_kind,
        "p_os":          info.os,
    });

    let resp = client
        .post(&url)
        .header("apikey", &supabase_anon_key)
        .header("Authorization", format!("Bearer {}", jwt))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("register_device request failed: {}", e))?;

    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    eprintln!("[MF DEVICE] register_device status={} body={}", status, text);

    if !status.is_success() {
        return Err(format!("register_device HTTP {}: {}", status, text));
    }
    serde_json::from_str(&text)
        .map_err(|e| format!("Invalid JSON: {} (body: {})", e, text))
}

#[tauri::command]
async fn mf_check_device_status(
    jwt: String,
    supabase_url: String,
    supabase_anon_key: String,
) -> Result<serde_json::Value, String> {
    let info = mf_get_device_info()?;
    let client = reqwest::Client::new();
    let url = format!("{}/rest/v1/rpc/check_device_status", supabase_url);

    let body = serde_json::json!({ "p_device_id": info.device_id });

    let resp = client
        .post(&url)
        .header("apikey", &supabase_anon_key)
        .header("Authorization", format!("Bearer {}", jwt))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("check_device_status request failed: {}", e))?;

    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    eprintln!("[MF DEVICE] check_status status={} body={}", status, text);

    if !status.is_success() {
        return Err(format!("check_device_status HTTP {}: {}", status, text));
    }
    serde_json::from_str(&text)
        .map_err(|e| format!("Invalid JSON: {} (body: {})", e, text))
}

// ============================================================
// 💳 7D: Stripe Checkout session
// ============================================================
// Frontend zavolá tento command s tier_id ("plus" alebo "unlimited") a JWT
// prihláseného usera. Backend (cez Edge Function create-checkout-session)
// vytvorí Stripe Checkout session a vráti URL.
// Frontend potom túto URL otvorí v default browseri.

#[command]
async fn mf_create_checkout_session(
    tier_id: String,
    access_token: String,
) -> Result<String, String> {
    println!("[MF] mf_create_checkout_session: tier_id={}", tier_id);

    if tier_id.is_empty() {
        return Err("tier_id is required".to_string());
    }
    if access_token.is_empty() {
        return Err("access_token is required (user must be logged in)".to_string());
    }

    let tier_id_clone = tier_id.clone();
    let access_token_clone = access_token.clone();

    let result = tokio::task::spawn_blocking(move || {
        backend::create_checkout_session(&tier_id_clone, &access_token_clone)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?;

    match result {
        Ok(resp) => {
            println!("[MF] ✅ Checkout session created: {}", resp.url);
            Ok(resp.url)
        }
        Err(e) => {
            eprintln!("[MF] ❌ Checkout session creation FAILED: {}", e);
            Err(e)
        }
    }
}

// ============================================================
// 💳 7E: Stripe Customer Portal session
// ============================================================
// Frontend zavolá tento command s JWT prihláseného usera. Backend
// (cez Edge Function create-portal-session) vytvorí Stripe Customer
// Portal session a vráti URL. Frontend ju otvorí v default browseri,
// kde si user sám spravuje predplatné (cancel, reactivation, payment
// method, invoices).

#[command]
async fn mf_create_portal_session(
    access_token: String,
) -> Result<String, String> {
    println!("[MF] mf_create_portal_session called");

    if access_token.is_empty() {
        return Err("access_token is required (user must be logged in)".to_string());
    }

    let access_token_clone = access_token.clone();

    let result = tokio::task::spawn_blocking(move || {
        backend::create_portal_session(&access_token_clone)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?;

    match result {
        Ok(resp) => {
            println!("[MF] ✅ Portal session created: {}", resp.portal_url);
            Ok(resp.portal_url)
        }
        Err(e) => {
            eprintln!("[MF] ❌ Portal session creation FAILED: {}", e);
            Err(e)
        }
    }
}

#[command]
async fn mf_post_received(
    app: AppHandle,
    network: String,
    source_id: String,
    posts: JsonValue,
) -> Result<(), String> {
    let post_count = posts.as_array().map(|a| a.len()).unwrap_or(0);
    println!("[MF] mf_post_received (legacy IPC): network={}, source={}, posts={}", network, source_id, post_count);

    if let Some(main_window) = app.get_webview_window("main") {
        let payload = serde_json::json!({
            "network": network,
            "sourceId": source_id,
            "posts": posts,
        });
        main_window
            .emit("mf-scraped-posts", payload)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[command]
async fn mf_validate_source(
    app: AppHandle,
    network: String,
    profile_name: String,
    request_id: String,
) -> Result<(), String> {
    let clean_name = profile_name
        .trim()
        .trim_start_matches('@')
        .trim_start_matches('/')
        .trim_end_matches('/')
        .to_string();

    if clean_name.is_empty() {
        return Err("Meno nesmie byť prázdne".to_string());
    }

    if clean_name.contains(' ') || clean_name.contains("http") || clean_name.contains("//") {
        return Err("Zadaj len meno stránky, nie URL ani medzery".to_string());
    }

    let url_str = match network.as_str() {
        "Facebook"  => format!("https://www.facebook.com/{}", clean_name),
        "Instagram" => format!("https://www.instagram.com/{}/", clean_name),
        "YouTube"   => format!("https://www.youtube.com/@{}", clean_name),
        _ => return Err(format!("Neznáma sieť: {}", network)),
    };

    println!("[MF] mf_validate_source: network={}, name={}, url={}", network, clean_name, url_str);

    let url = url_str.parse::<tauri::Url>().map_err(|e| format!("URL parse: {}", e))?;
    let label = format!(
        "validate_{}_{}_{}",
        network.to_lowercase(),
        request_id,
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    );

    if let Some(existing) = app.get_webview_window(&label) {
        let _ = existing.close();
    }

    let webview = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(url))
        .title(&format!("Overujem {} {}", network, clean_name))
        .inner_size(800.0, 600.0)
        .visible(false)
        .focused(false)
        .skip_taskbar(true)
        .build()
        .map_err(|e| format!("Webview build: {}", e))?;

    let webview_clone = webview.clone();
    let network_clone = network.clone();
    let clean_name_clone = clean_name.clone();
    let request_id_clone = request_id.clone();
    let label_clone = label.clone();
    let app_clone = app.clone();

    thread::spawn(move || {
        thread::sleep(Duration::from_secs(5));

        let validator_script = format!(r#"
            (function() {{
                const network = "{network}";
                const name = "{name}";
                const requestId = "{request_id}";

                const SKIP_NAMES = /^(Profil|Profile|Domov|Home|Facebook|Instagram|Marketplace|Hľadať|Search|Watch|News|Správy|Menu|YouTube|Videá|Videos)$/i;

                function pickName(candidates, fallback) {{
                    for (let i = 0; i < candidates.length; i++) {{
                        const t = (candidates[i] || '').replace(/\s+/g, ' ').trim();
                        if (!t) continue;
                        if (SKIP_NAMES.test(t)) continue;
                        if (t.length > 100) continue;
                        return t;
                    }}
                    return fallback;
                }}

                function parseTitleName(title, networkLabel) {{
                    if (!title) return null;
                    const re = new RegExp('^(.+?)\\s*[|·\\-—–]\\s*' + networkLabel, 'i');
                    const m = title.match(re);
                    if (m) return m[1].trim();
                    const igRe = /^(.+?)\s*\(@[^)]+\)\s*[•·]/;
                    const m2 = title.match(igRe);
                    if (m2) return m2[1].trim();
                    return null;
                }}

                let exists = false;
                let displayName = name;
                let avatarUrl = null;
                let reason = "";

                const bodyText = document.body ? (document.body.innerText || '').toLowerCase() : '';
                const title = document.title.toLowerCase();

                const notFoundSignals = [
                    'page not found',
                    'stránka sa nenašla',
                    'sorry, this page',
                    'tento obsah momentálne nie je dostupný',
                    "this content isn\u0027t available",
                    "this page isn\u0027t available",
                    'user not found',
                    'tento účet neexistuje',
                    "couldn\u0027t find this account",
                    '404',
                ];

                let hasNotFound = notFoundSignals.some(s => bodyText.includes(s) || title.includes(s));

                if (network === 'Facebook') {{
                    const hasH1 = !!document.querySelector('h1');
                    const hasProfile = hasH1 && !hasNotFound && !window.location.href.includes('/login');
                    exists = hasProfile;
                    if (exists) {{
                        const mainH1s = Array.from(document.querySelectorAll('[role="main"] h1, [role="main"] h2'))
                            .map(h => h.innerText);
                        const allH1s = Array.from(document.querySelectorAll('h1'))
                            .map(h => h.innerText);
                        const titleParsed = parseTitleName(document.title, 'Facebook');

                        displayName = pickName(
                            mainH1s.concat(allH1s).concat(titleParsed ? [titleParsed] : []),
                            name
                        );

                        const profileImg = document.querySelector('image, svg image, [role="main"] img');
                        if (profileImg) avatarUrl = profileImg.getAttribute('xlink:href') || profileImg.src || null;
                    }}
                    if (!exists) reason = hasNotFound ? 'Stránka neexistuje' : 'Vyžaduje prihlásenie alebo profil je súkromný';
                }}
                else if (network === 'Instagram') {{
                    const header = document.querySelector('header, section header, main header');
                    const hasProfile = header && !hasNotFound &&
                                       !document.body.innerText.toLowerCase().includes("sorry, this page isn");
                    exists = hasProfile;
                    if (exists) {{
                        const candidates = [];
                        document.querySelectorAll('header h1, header h2, main header h1, main header h2, section header h1, section header h2')
                            .forEach(h => candidates.push(h.innerText));
                        document.querySelectorAll('header span[dir="auto"]')
                            .forEach(s => candidates.push(s.innerText));
                        const titleParsed = parseTitleName(document.title, 'Instagram');
                        if (titleParsed) candidates.push(titleParsed);

                        displayName = pickName(candidates, name);

                        const img = document.querySelector('header img, main header img');
                        if (img) avatarUrl = img.src;
                    }}
                    if (!exists) reason = 'Profil neexistuje alebo je súkromný';
                }}
                else if (network === 'YouTube') {{
                    const onSearchPage = window.location.href.includes('/results?');
                    const channelHeader = document.querySelector('ytd-channel-name, #channel-name, yt-formatted-string#text');
                    exists = !onSearchPage && !hasNotFound && !!channelHeader;
                    if (exists) {{
                        const candidates = [];
                        document.querySelectorAll('ytd-channel-name yt-formatted-string, #channel-name #text, #channel-header h1')
                            .forEach(el => candidates.push(el.innerText));
                        const titleParsed = parseTitleName(document.title, 'YouTube');
                        if (titleParsed) candidates.push(titleParsed);

                        displayName = pickName(candidates, name);

                        const avatar = document.querySelector('#channel-header img, ytd-channel-avatar-editor img, yt-img-shadow#avatar img');
                        if (avatar) avatarUrl = avatar.src;
                    }}
                    if (!exists) reason = onSearchPage ? 'Kanál s týmto menom neexistuje' : 'Kanál sa nepodarilo načítať';
                }}

                console.log('[MF validate] network=' + network + ' exists=' + exists + ' displayName=' + displayName);

                const invoke = (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke)
                    || (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke);

                if (invoke) {{
                    invoke('mf_validation_result', {{
                        requestId: requestId,
                        network: network,
                        profileName: name,
                        exists: exists,
                        displayName: displayName,
                        avatarUrl: avatarUrl,
                        reason: reason,
                    }}).catch(e => console.error('[MF validate] IPC failed:', e));
                }} else {{
                    console.error('[MF validate] No IPC available');
                }}
            }})();
        "#, network = network_clone, name = clean_name_clone, request_id = request_id_clone);

        let _ = webview_clone.eval(&validator_script);

        thread::sleep(Duration::from_secs(3));
        if let Some(w) = app_clone.get_webview_window(&label_clone) {
            let _ = w.close();
        }
    });

    Ok(())
}

#[command]
async fn mf_validation_result(
    app: AppHandle,
    request_id: String,
    network: String,
    profile_name: String,
    exists: bool,
    display_name: String,
    avatar_url: Option<String>,
    reason: String,
) -> Result<(), String> {
    println!("[MF] mf_validation_result: requestId={}, exists={}, displayName={}",
             request_id, exists, display_name);

    if let Some(main_window) = app.get_webview_window("main") {
        let payload = serde_json::json!({
            "requestId": request_id,
            "network": network,
            "profileName": profile_name,
            "exists": exists,
            "displayName": display_name,
            "avatarUrl": avatar_url,
            "reason": reason,
        });
        main_window
            .emit("mf-validation-result", payload)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ============================================================
// 🖼️ Image inlining helpers (used for Instagram CDN hotlink bypass)
// ============================================================

fn fetch_as_data_url(
    client: &reqwest::blocking::Client,
    url: &str,
    referer: &str,
) -> Option<String> {
    let resp = match client.get(url)
        .header("Referer", referer)
        .header("Accept", "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8")
        .header("Sec-Fetch-Dest", "image")
        .header("Sec-Fetch-Mode", "no-cors")
        .header("Sec-Fetch-Site", "cross-site")
        .send()
    {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[MF img] fetch error for {}: {}", &url[..url.len().min(80)], e);
            return None;
        }
    };

    if !resp.status().is_success() {
        eprintln!("[MF img] non-2xx status {} for {}",
            resp.status(),
            &url[..url.len().min(80)]);
        return None;
    }

    let content_type = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.split(';').next().unwrap_or(s).trim().to_string())
        .filter(|s| s.starts_with("image/") || s.starts_with("video/"))
        .unwrap_or_else(|| guess_mime_from_url(url));

    let bytes = match resp.bytes() {
        Ok(b) => b,
        Err(e) => {
            eprintln!("[MF img] body read error: {}", e);
            return None;
        }
    };

    if bytes.is_empty() {
        return None;
    }
    if bytes.len() > 8_000_000 {
        eprintln!("[MF img] skipping {} bytes (over 8MB cap)", bytes.len());
        return None;
    }

    let b64 = base64_encode(&bytes);
    println!(
        "[MF img] ✓ {} bytes ({}) ← {}",
        bytes.len(),
        content_type,
        &url[..url.len().min(80)]
    );
    Some(format!("data:{};base64,{}", content_type, b64))
}

fn guess_mime_from_url(url: &str) -> String {
    let lower = url.to_lowercase();
    if lower.contains(".png") { "image/png".to_string() }
    else if lower.contains(".webp") { "image/webp".to_string() }
    else if lower.contains(".gif") { "image/gif".to_string() }
    else if lower.contains(".mp4") { "video/mp4".to_string() }
    else if lower.contains(".heic") { "image/heic".to_string() }
    else { "image/jpeg".to_string() }
}

fn base64_encode(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    let mut out = String::with_capacity((bytes.len() + 2) / 3 * 4);
    let mut i = 0;

    while i + 3 <= bytes.len() {
        let n = ((bytes[i] as u32) << 16)
            | ((bytes[i + 1] as u32) << 8)
            | (bytes[i + 2] as u32);
        out.push(ALPHABET[((n >> 18) & 0x3F) as usize] as char);
        out.push(ALPHABET[((n >> 12) & 0x3F) as usize] as char);
        out.push(ALPHABET[((n >> 6)  & 0x3F) as usize] as char);
        out.push(ALPHABET[( n        & 0x3F) as usize] as char);
        i += 3;
    }

    let rem = bytes.len() - i;
    if rem == 1 {
        let n = (bytes[i] as u32) << 16;
        out.push(ALPHABET[((n >> 18) & 0x3F) as usize] as char);
        out.push(ALPHABET[((n >> 12) & 0x3F) as usize] as char);
        out.push('=');
        out.push('=');
    } else if rem == 2 {
        let n = ((bytes[i] as u32) << 16) | ((bytes[i + 1] as u32) << 8);
        out.push(ALPHABET[((n >> 18) & 0x3F) as usize] as char);
        out.push(ALPHABET[((n >> 12) & 0x3F) as usize] as char);
        out.push(ALPHABET[((n >> 6)  & 0x3F) as usize] as char);
        out.push('=');
    }

    out
}

// ============================================================
// 🚀 Tauri entry point
// ============================================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|_app| {
            // 7A test: overí, že backend connector funguje
            std::thread::spawn(|| {
                println!("[MF] 🔌 Calling backend at startup...");
                match backend::fetch_status(None) {
                    Ok(resp) => {
                        println!(
                            "[MF] ✅ Backend OK: tier={}, max_profiles_per_platform={}, available_tiers={}",
                            resp.status.tier,
                            resp.status.max_profiles_per_platform,
                            resp.available_tiers.len()
                        );
                    }
                    Err(e) => {
                        eprintln!("[MF] ❌ Backend error: {}", e);
                    }
                }
            });

            // 7B: fetch zen script zo serveru a cache do OnceLock
            std::thread::spawn(|| {
                println!("[MF] 📜 Fetching zen script from backend...");
                match backend::fetch_zen_script() {
                    Ok(resp) => match resp.script_content {
                        Some(script) if !script.is_empty() => {
                            let version = resp.script_version.as_deref().unwrap_or("?").to_string();
                            let size = script.len();
                            if ZEN_SCRIPT_CACHE.set(script).is_ok() {
                                println!(
                                    "[MF] ✅ Zen script loaded from server: version={}, size={} bytes",
                                    version, size
                                );
                            } else {
                                eprintln!("[MF] ⚠ Zen script cache already populated (race?)");
                            }
                        }
                        _ => {
                            println!(
                                "[MF] ℹ Server returned no active script — using bundled fallback ({})",
                                resp.message.as_deref().unwrap_or("no message")
                            );
                        }
                    },
                    Err(e) => {
                        eprintln!(
                            "[MF] ⚠ Zen script fetch failed: {} — using bundled fallback",
                            e
                        );
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
    otvor_prihlasenie,
    mf_scrape_profile,
    mf_post_received,
    mf_validate_source,
    mf_validation_result,
    mf_get_status,
    mf_create_checkout_session,
    mf_create_portal_session,
    mf_get_device_info,
    mf_register_device,
    mf_check_device_status,
])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}