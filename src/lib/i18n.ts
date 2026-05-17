import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import sk from "../locales/sk.json";
import en from "../locales/en.json";
import cs from "../locales/cs.json";
import de from "../locales/de.json";
import fr from "../locales/fr.json";
import es from "../locales/es.json";
import it from "../locales/it.json";
import pt from "../locales/pt.json";
import nl from "../locales/nl.json";
import pl from "../locales/pl.json";
import hu from "../locales/hu.json";
import ro from "../locales/ro.json";
import bg from "../locales/bg.json";
import el from "../locales/el.json";
import da from "../locales/da.json";
import sv from "../locales/sv.json";
import fi from "../locales/fi.json";
import et from "../locales/et.json";
import lv from "../locales/lv.json";
import lt from "../locales/lt.json";
import sl from "../locales/sl.json";
import hr from "../locales/hr.json";
import mt from "../locales/mt.json";
import ga from "../locales/ga.json";

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      sk: { translation: sk },
      en: { translation: en },
      cs: { translation: cs },
      de: { translation: de },
      fr: { translation: fr },
      es: { translation: es },
      it: { translation: it },
      pt: { translation: pt },
      nl: { translation: nl },
      pl: { translation: pl },
      hu: { translation: hu },
      ro: { translation: ro },
      bg: { translation: bg },
      el: { translation: el },
      da: { translation: da },
      sv: { translation: sv },
      fi: { translation: fi },
      et: { translation: et },
      lv: { translation: lv },
      lt: { translation: lt },
      sl: { translation: sl },
      hr: { translation: hr },
      mt: { translation: mt },
      ga: { translation: ga },
    },
    fallbackLng: "en",
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: "meshynet_lang",
      caches: ["localStorage"],
    },
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;
