import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Post } from "../types";
import { Avatar } from "./Avatar";
import { formatRelativeTime, isLikelyValidImage } from "../lib/format";
import { extractYouTubeVideoId } from "../lib/youtube";
import { openExternal } from "../lib/tauri";
import { useTheme } from "../lib/theme-context";

export function PostCard({ post }: { post: Post }) {
  const { t } = useTranslation();
  const { colors: c } = useTheme();
  const [imageError, setImageError] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [videoEmbedded, setVideoEmbedded] = useState(false);

  const showImage = post.imageUrl && !imageError && isLikelyValidImage(post.imageUrl);
  const showVideoThumb =
    post.videoThumbUrl && !imageError && isLikelyValidImage(post.videoThumbUrl);

  // YouTube embed support: extract video ID z permalinku ak je to YT post
  const youtubeVideoId = post.network === "YouTube"
    ? extractYouTubeVideoId(post.permalink)
    : null;
  const canEmbedYouTube = !!youtubeVideoId && showVideoThumb;

  // Klik na celú kartu otvorí permalink, OKREM YT prípadu kde:
  // - video embed → klik na video sa rieši samostatne (prepne na embed)
  // - klik mimo videa stále otvorí YouTube
  // Embedded iframe samotný má pointer-events: auto a stopPropagation aby
  // kliky vnútri prehrávača (play/pause/seek) nešli na článok.
  const handleCardClick = () => {
    if (post.permalink) openExternal(post.permalink);
  };

  const handleThumbnailClick = (e: React.MouseEvent) => {
    if (canEmbedYouTube) {
      e.stopPropagation();
      setVideoEmbedded(true);
    }
    // Pre FB/IG s thumbnailom → propaguj klik na článok, otvorí permalink
  };

  const handleOpenYouTube = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (post.permalink) openExternal(post.permalink);
  };

  return (
    <article
      onClick={handleCardClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: c.bgElevated,
        border: `0.5px solid ${c.border}`,
        borderRadius: 14,
        padding: "18px 20px",
        cursor: post.permalink ? "pointer" : "default",
        transition: "transform 180ms ease, box-shadow 180ms ease",
        transform: hovered && !videoEmbedded ? "translateY(-1px)" : "none",
        boxShadow: hovered && !videoEmbedded ? c.shadow : "none",
        fontFamily: "'Manrope', sans-serif",
      }}
    >
      <header style={{
        display: "flex", alignItems: "center", gap: 12, marginBottom: 12,
      }}>
        <Avatar name={post.sourceName} src={post.authorAvatar} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{
            fontSize: 15, fontWeight: 500, color: c.fg, lineHeight: 1.3,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {post.sourceName}
          </div>
          <div style={{ fontSize: 13, color: c.muted, marginTop: 1 }}>
            {formatRelativeTime(post.publishedAt)} · {post.network}
          </div>
        </div>
      </header>

      {post.body && (
        <p style={{
          fontFamily: "'Manrope', sans-serif",
          fontSize: 15, lineHeight: 1.65, color: c.fgSecondary,
          margin: showImage || showVideoThumb ? "0 0 12px" : "0",
          fontWeight: 400,
          display: "-webkit-box",
          WebkitLineClamp: 6,
          WebkitBoxOrient: "vertical" as any,
          overflow: "hidden",
          wordBreak: "break-word",
        }}>
          {post.body}
        </p>
      )}

      {showImage && (
        <img
          src={post.imageUrl}
          alt=""
          onError={() => setImageError(true)}
          style={{
            width: "100%", maxHeight: 320, objectFit: "cover",
            borderRadius: 8, display: "block",
          }}
        />
      )}

      {/* YouTube embed mode: iframe player + "Otvoriť na YouTube" link */}
      {showVideoThumb && videoEmbedded && canEmbedYouTube && (
        <div onClick={(e) => e.stopPropagation()}>
          <div style={{
            position: "relative",
            paddingBottom: "56.25%", // 16:9 aspect ratio
            height: 0,
            overflow: "hidden",
            borderRadius: 8,
            background: "#000",
          }}>
            <iframe
              src={`https://www.youtube.com/embed/${youtubeVideoId}?autoplay=1&rel=0`}
              title={post.body || "YouTube video"}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              style={{
                position: "absolute",
                top: 0, left: 0,
                width: "100%", height: "100%",
                border: "none",
              }}
            />
          </div>
          <button
            onClick={handleOpenYouTube}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              marginTop: 10,
              padding: "6px 10px",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 500,
              color: c.muted,
              fontFamily: "inherit",
              borderRadius: 6,
              transition: "color 160ms ease, background 160ms ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--accent)";
              e.currentTarget.style.background = "var(--input-bg)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--muted)";
              e.currentTarget.style.background = "transparent";
            }}
            title={t("postCard.openYouTubeTitle")}
          >
            {t("postCard.openOnYouTube")}
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 17L17 7"/>
              <polyline points="7 7 17 7 17 17"/>
            </svg>
          </button>
        </div>
      )}

      {/* Thumbnail mode (initial state pre videá) */}
      {showVideoThumb && !videoEmbedded && (
        <div
          onClick={handleThumbnailClick}
          style={{
            position: "relative",
            borderRadius: 8,
            overflow: "hidden",
            cursor: canEmbedYouTube ? "pointer" : (post.permalink ? "pointer" : "default"),
          }}
        >
          <img
            src={post.videoThumbUrl}
            alt=""
            onError={() => setImageError(true)}
            style={{
              width: "100%", maxHeight: 320, objectFit: "cover", display: "block",
            }}
          />
          <div style={{
            position: "absolute", top: "50%", left: "50%",
            transform: "translate(-50%, -50%)",
            width: 64, height: 64,
            background: canEmbedYouTube ? "#ff0000" : "rgba(0,0,0,0.55)",
            borderRadius: canEmbedYouTube ? 14 : "50%",
            display: "flex",
            alignItems: "center", justifyContent: "center",
            boxShadow: canEmbedYouTube ? "0 4px 16px rgba(0,0,0,0.35)" : "none",
            transition: "transform 180ms ease",
          }}>
            <div style={{
              width: 0, height: 0, borderStyle: "solid",
              borderWidth: "10px 0 10px 16px",
              borderColor: "transparent transparent transparent #ffffff",
              marginLeft: 4,
            }}/>
          </div>
        </div>
      )}
    </article>
  );
}
