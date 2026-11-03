import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Demo Barbers: book a chair", template: "%s | Demo Barbers" },
  description: "A fictional barber shop showing how online booking with a deposit works. Test payments only.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

// Runs before the first paint so a saved theme never flashes. Storage can be blocked, so it fails quietly to Auto.
// The home page's opening animation plays on the first visit of a browser session only, and is cleared once it has run.
const THEME_SCRIPT = `try{var t=localStorage.getItem("db-theme");if(t==="light"||t==="dark"||t==="auto")document.documentElement.dataset.theme=t}catch(e){}try{if(location.pathname==="/"&&!sessionStorage.getItem("db-intro")){sessionStorage.setItem("db-intro","1");var d=document.documentElement;d.setAttribute("data-intro","");setTimeout(function(){d.removeAttribute("data-intro")},4000)}}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" data-theme="auto" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body id="top">
        <div className="banner" role="region" aria-label="Demo notice">
          Demo. Nothing is sold, test payments only
        </div>
        {children}
      </body>
    </html>
  );
}
