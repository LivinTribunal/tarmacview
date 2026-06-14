import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import en from "./locales/en.json";
import sk from "./locales/sk.json";

export const SUPPORTED_LANGUAGES = [
  { code: "en", label: "English", short: "EN" },
  { code: "sk", label: "Slovenčina", short: "SK" },
] as const;

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]["code"];

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      sk: { translation: sk },
    },
    fallbackLng: "en",
    supportedLngs: SUPPORTED_LANGUAGES.map((l) => l.code),
    nonExplicitSupportedLngs: true,
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: "tarmacview_language",
      caches: ["localStorage"],
    },
    interpolation: { escapeValue: false },
  });

export default i18n;
