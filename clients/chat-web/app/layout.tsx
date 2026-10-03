import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Noto_Sans_SC } from "next/font/google";
import { cookies, headers } from "next/headers";
import { IntlProvider } from "./intl-provider";
import { Providers } from "./providers";
import { LOCALE_COOKIE, resolveLocale } from "@/i18n/locale";
import { loadMessages } from "@/i18n/messages";
import "./globals.css";

const plusJakarta = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta",
  subsets: ["latin"],
  weight: ["500", "700", "800"],
});

// CJK font: Google serves it as many unicode-range slices; only the latin
// subset is declared and preloading is off so the large slices load on demand.
const notoSansSC = Noto_Sans_SC({
  variable: "--font-noto-sc",
  subsets: ["latin"],
  weight: ["500", "700", "900"],
  preload: false,
});

export const metadata: Metadata = {
  title: "Hilda",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = resolveLocale(
    (await cookies()).get(LOCALE_COOKIE)?.value,
    (await headers()).get("accept-language"),
  );
  return (
    <html
      lang={locale}
      className={`${plusJakarta.variable} ${notoSansSC.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <IntlProvider locale={locale} messages={loadMessages(locale)}>
          <Providers>{children}</Providers>
        </IntlProvider>
      </body>
    </html>
  );
}
