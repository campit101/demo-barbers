import { getImageProps } from "next/image";
import Link from "next/link";
import { BarberNextFree, NextFreeRows } from "@/components/site/NextFree";
import { Photo, SHOP_ALT } from "@/components/site/Photo";
import { ServiceRows } from "@/components/site/ServiceRows";
import { SiteNav } from "@/components/site/SiteNav";
import { Stages } from "@/components/site/Stages";
import { BARBERS } from "@/config/shop";

const HERO_ALT = "Marek giving a young client a skin fade, with the walnut bench and the shop's front windows behind them. AI-generated.";

const FRONT_ALT = "The shop from across the street: a bottle-green shopfront with Demo Barbers on the fascia, a red-brick terrace above and a bike against the railings. AI-generated.";

const FAQS = [
  { q: "Is this a real shop?", a: "No. Demo Barbers is made up to show what a booking system can do. Nothing is sold, the barbers are invented, and only test payments are taken." },
  { q: "What does the deposit cover?", a: "It is 20% of the price and comes off your bill. You pay the rest in the shop." },
  { q: "What if I need to cancel?", a: "Cancel with your private link up to 24 hours before and the deposit is refunded. Later than that, the deposit is kept." },
  { q: "Can I move my booking?", a: "Yes, up to 24 hours before. The same link lets you pick a new time, and your deposit moves with you." },
  { q: "Do I need an account?", a: "No. You give a name and an email, and after paying you get a private link that is all you need. This demo sends no emails, so save the link when it is shown." },
  { q: "What happens to my details?", a: "This demo deletes every booking after 24 hours. It does no tracking, and sets no cookies unless you sign in to try the admin." },
];

const HERO_LOADED = `(function(){var s=document.currentScript,b=s&&s.parentNode,i=b&&b.querySelector("img");if(!i)return;function on(){b.setAttribute("data-loaded","")}if(i.complete&&i.naturalWidth)on();else i.addEventListener("load",on)})()`;

/** One photo per screen shape, so a phone never downloads the wide one. */
function HeroPicture() {
  // Higher quality than the default: this is the first thing anyone sees, and it fills over half the screen.
  const common = { alt: HERO_ALT, priority: true, quality: 90 };
  const { props: wide } = getImageProps({ ...common, src: "/photos/hero-wide.jpg", width: 1376, height: 768, sizes: "59vw" });
  const { props: tall } = getImageProps({ ...common, src: "/photos/hero-phone.jpg", width: 768, height: 1376, sizes: "(max-width: 720px) 100vw, 54vw" });
  return (
    <picture>
      <source media="(max-width: 1023px)" srcSet={tall.srcSet} sizes={tall.sizes} />
      <source media="(min-width: 1024px)" srcSet={wide.srcSet} sizes={wide.sizes} />
      <img {...wide} alt={HERO_ALT} />
    </picture>
  );
}

function Chevron() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M3 6l6 6 6-6" />
    </svg>
  );
}

export default function Home() {
  return (
    <>
      <SiteNav />
      <main id="main">
        <section className="hero">
          <div className="hero-pic" suppressHydrationWarning>
            <HeroPicture />
            {/* The opening reveal waits for the photo itself, so a slow connection never sees it pop in after the animation. */}
            <script dangerouslySetInnerHTML={{ __html: HERO_LOADED }} />
          </div>
          <div className="panel">
            <h1 className="disp hero-name">
              Demo
              <br />
              Barbers
            </h1>
            <p className="hero-sub">Sharp cuts, easy chat and a chair held just for you. Pick a service, a barber and a time, and a 20% deposit keeps it yours.</p>
            <Link className="btn-tan hero-book" href="/book">
              Book a chair
            </Link>
            <div className="chair">
              <h2 className="chair-h">Next free chair</h2>
              <NextFreeRows />
            </div>
          </div>
        </section>
        <div className="bands" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>

        <section className="sec" id="services">
          <h2 className="disp head reveal">
            Four services,
            <br />
            two chairs
          </h2>
          <ServiceRows />
        </section>

        <section className="shop" id="shop">
          <div className="shop-text">
            <h2 className="disp head reveal">
              Come for the cut,
              <br />
              stay for the chat
            </h2>
            <div>
              <p>Two chairs, one long bench and plenty of daylight. The coffee is on while you wait.</p>
              <dl className="hours">
                <dt>Tuesday to Saturday</dt>
                <dd>09:00 to 18:00</dd>
                <dt>Sunday and Monday</dt>
                <dd>Closed</dd>
              </dl>
            </div>
          </div>
          <div className="shop-grid">
            <div className="shop-main reveal">
              <Photo src="/photos/shop.jpg" alt={SHOP_ALT} sizes="(max-width: 720px) 100vw, 66vw" />
            </div>
            <div className="shop-side reveal">
              <Photo src="/photos/bench.jpg" alt="Two friends chatting on the waiting bench, one holding a takeaway coffee. AI-generated." sizes="(max-width: 720px) 100vw, 33vw" />
            </div>
            <div className="shop-side reveal">
              <Photo src="/photos/jar.jpg" alt="A walnut counter with combs in blue disinfectant, and scissors and a razor on a folded towel. AI-generated." sizes="(max-width: 720px) 100vw, 33vw" style={{ objectPosition: "60% 62%" }} />
            </div>
          </div>
        </section>

        <section className="barbers" id="barbers">
          <h2 className="disp head reveal">Meet your barbers</h2>
          <div className="bar-cards">
            {BARBERS.map((b) => (
              <article key={b.id} className="bcard reveal">
                <div className="bcard-img">
                  <Photo src={b.photo} alt={b.alt} sizes="(max-width: 720px) 100vw, 50vw" />
                </div>
                <h3>{b.name}</h3>
                <p>{b.line}</p>
                <p className="tiny">
                  Invented person, AI-generated photo.
                  <BarberNextFree barberId={b.id} />
                </p>
                <Link className="btn-tan" href={`/book?barber=${b.id}`}>
                  Book with {b.name}
                </Link>
              </article>
            ))}
          </div>
        </section>

        <section className="sec">
          <div className="how-top">
            <h2 className="disp head reveal">How booking works</h2>
            <p>No account and no password. One private link does everything, and the slot is yours from the moment you start paying.</p>
          </div>
          <Stages />
        </section>

        <section className="sec" id="questions" style={{ paddingTop: 0 }}>
          <h2 className="disp head reveal">Before you sit down</h2>
          <div className="faq-list">
            {FAQS.map((f) => (
              <details key={f.q}>
                <summary>
                  {f.q}
                  <Chevron />
                </summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="front" id="find-us">
          <div className="front-pic reveal">
            <Photo src="/photos/shopfront.jpg" alt={FRONT_ALT} sizes="(max-width: 720px) 100vw, 66vw" />
          </div>
          <div className="front-text">
            <h2 className="disp head reveal">
              Look for the
              <br />
              green door
            </h2>
            <p>A bottle-green front on a quiet red-brick terrace, with the bench in the window and a bike against the railings.</p>
            <p className="front-note">Demo Barbers is invented, so there is no street to find. Booking, deposits and the shop&apos;s diary all work.</p>
          </div>
        </section>

        <Link className="cta" href="/book" aria-label="Book a chair">
          <span className="cta-top">
            <span>Pick a service, a barber and a time.</span>
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
              <path d="M10 38L38 10M14 10h24v24" />
            </svg>
          </span>
          <span className="disp cta-word">Book</span>
        </Link>
      </main>

      <footer className="foot">
        <div className="foot-grid">
          <div>
            <h2 className="disp">
              See the shop&apos;s
              <br />
              side of it
            </h2>
            <Link className="btn-tan" href="/admin/sign-in">
              Try the admin
            </Link>
          </div>
          <div className="foot-links">
            <Link href="/#services">Services</Link>
            <Link href="/#barbers">Barbers</Link>
            <Link href="/#questions">Questions</Link>
            <a href="https://tarnfieldstudio.com/">Built by Tarnfield</a>
          </div>
        </div>
        <div className="legal">
          <span>A fictional shop. Photos AI-generated with Google Gemini.</span>
          <span>No tracking, and no cookies unless you sign in to the admin. Demo data deleted after 24 hours.</span>
        </div>
        <div className="disp foot-name" aria-hidden="true">
          Demo Barbers
        </div>
      </footer>
    </>
  );
}
