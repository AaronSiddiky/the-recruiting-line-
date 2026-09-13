import Image from "next/image";
import styles from "./page.module.css";
import HeroVideo from "./components/HeroVideo";
import Nav from "./components/Nav";
import StatementReveal from "./components/StatementReveal";
import WorkOrderForm from "./components/WorkOrderForm";
import { site, phoneHref } from "./site";
import { preload } from "react-dom";

const EMAIL = site.email;

const LOGOS = [
  "Summit Mechanical",
  "Northline Freight",
  "Ridge HVAC",
  "Bayfield Electric",
  "Ironworks Fab",
  "Cascade Plumbing",
  "Delta Fleet Services",
  "Harbor Cold Chain",
  "Prairie Diesel",
  "Keystone Facilities",
];

const STATS = [
  { n: "110,000", l: "Open HVAC tech seats in the US" },
  { n: "45–90", l: "Days the average seat sits empty" },
  { n: "7", l: "Days until we present candidates" },
  { n: "30", l: "Day replacement guarantee" },
];

type Feature = {
  id: string;
  eyebrow: string;
  lead: string;
  rest: string;
  items: { t: string; d: string }[];
};

const SOURCING: Feature = {
  id: "sourcing",
  eyebrow: "Sourcing",
  lead: "We're always searching.",
  rest: "Job boards, referrals, union halls, trade schools, the techs your competitors are underpaying. We find the people who aren't applying.",
  items: [
    { t: "Wherever they are", d: "Most good tradespeople aren't on Indeed. We call, text and show up where they already are." },
    { t: "Licensed and local", d: "EPA 608, CDL-A with clean MVR, journeyman card. We verify before you ever see a name." },
    { t: "Candidates in 7 days", d: "Vetted candidates on your desk within 7 days. Miss the deadline and we pay you $500." },
  ],
};

const SCREENING: Feature = {
  id: "screening",
  eyebrow: "Screening",
  lead: "We're always vetting.",
  rest: "Phone screens, reference calls, background and drug checks, the awkward pay conversation. You only meet people worth your time.",
  items: [
    { t: "The phone calls", d: "Every candidate is screened by a recruiter who has worked the trade, not a keyword filter." },
    { t: "The follow-ups", d: "\"Did he confirm the interview?\" \"Did her references call back?\" We chase every loose thread so you don't." },
    { t: "The scheduling", d: "Interviews land on your calendar. Offers go out the same day you say yes." },
  ],
};

const GUARANTEE: Feature = {
  id: "guarantee",
  eyebrow: "Guarantee",
  lead: "We're paid when they stay.",
  rest: "No retainer, no deposit, no invoice on day one. If the hire doesn't last 30 days, you owe nothing.",
  items: [
    { t: "$0 up front", d: "Nothing due at signature, nothing due at offer, nothing due at start." },
    { t: "One flat fee", d: "$7,500 per hire. No retainers, no percentage math. Due only after day 30." },
    { t: "If they leave", d: "He leaves or you fire him inside 30 days: we replace him free. As many times as it takes." },
  ],
};

const TIMELINE = [
  { day: "Day 0 · Signed", amt: "$0" },
  { day: "Day 1 · Start", amt: "$0" },
  { day: "Day 7 · Candidates", amt: "$0" },
  { day: "Day 30 · Proven out", amt: "$7,500" },
];

const FEES = [
  { t: "Search opened, seat briefed", d: "15-minute call. We map the role, pay band, certs, and territory.", a: "$0" },
  { t: "Vetted candidates presented within 7 days", d: "Licensed, screened, reference-checked, ready to interview.", a: "$0" },
  { t: "You hire. We negotiate the offer, set the start date.", d: "He shows up day one. Still nothing due.", a: "$0" },
  { t: "Hire completes his first 30 days", d: "The only line you ever pay, and only once he has proven out.", a: "$7,500" },
  { t: "We miss the 7-day candidate deadline", d: "No vetted candidates on your desk by day 7 and the miss is on us. Search continues, and you get paid for the wait.", a: "we pay you $500" },
  { t: "He leaves or you fire him inside 30 days", d: "We replace him free. As many times as it takes.", a: "$0" },
];

const STEPS = [
  { when: "Day 0", t: "Brief the seat", d: "One 15-minute call. Role, certs, pay band, territory, what the last guy got wrong." },
  { when: "Days 1–7", t: "We hunt", d: "Applicants and passive techs screened the same day they surface, day or night. You see only the ones worth your time." },
  { when: "Days 7–14", t: "Interview & offer", d: "We schedule everything inside 48 hours and negotiate the offer so it sticks. Deals die in the gaps; we don't leave gaps." },
  { when: "Days 1–30", t: "He proves out or we replace him", d: "Check-ins at day 7 and day 30. If it breaks inside the first 30 days, we run it again for free." },
];

const FIT_YES = [
  "A multi-location or PE-backed home services operator with an approved, open tech seat",
  "An independent shop where an empty truck is costing you jobs this week",
  "Tired of paying 20–25% of salary for unvetted resumes and no guarantee",
  "Ready to interview within 48 hours of seeing a candidate",
];

const FIT_NO = [
  "Want to \"build a pipeline\" with no approved hire behind it",
  "Need temp day labor rather than a permanent tech",
  "Pay under market and want a recruiter to talk someone into it",
  "Take three weeks to schedule an interview",
];

function FeatureText({ f }: { f: Feature }) {
  return (
    <>
      <div className={styles.eyebrow}>{f.eyebrow}</div>
      <h3 className={styles.h3}>
        {f.lead} <span>{f.rest}</span>
      </h3>
      <div className={styles.subFeatures}>
        {f.items.map((item) => (
          <div key={item.t}>
            <div className={styles.subTitle}>{item.t}</div>
            <p className={styles.subBody}>{item.d}</p>
          </div>
        ))}
      </div>
      <a href={`mailto:${EMAIL}`} className={styles.learnMore}>
        Learn more <span>→</span>
      </a>
    </>
  );
}

export default function Home() {
  preload("/hero/poster.webp", { as: "image", fetchPriority: "high" });
  return (
    <div className={styles.page}>
      {/* 1. Hero */}
      <section id="top" className={styles.hero}>
        <HeroVideo />
        <div className={styles.scrim} />
        <Nav />
        <div className={styles.heroBody}>
          <div className={styles.heroInner}>
            <h1 className={styles.h1}>Every day you leave a seat open you lose money.</h1>
            <p className={styles.heroSub}>
              Let us do the hiring, and pay us only when someone we find stays for at least 30 days. We&apos;ve placed HVAC techs, CDL drivers, diesel mechanics, and electricians.
            </p>
            <div className={styles.heroCtas}>
              <a href="#start" className={`${styles.pill} ${styles.pillWhite}`}>
                Start a search
              </a>
              <a href="#offer" className={`${styles.pill} ${styles.pillOutline}`}>
                See the terms <span>→</span>
              </a>
            </div>
          </div>
        </div>
        <div className={styles.marqueeWrap}>
          <div className={styles.marqueeMask}>
            <div className={styles.marquee}>
              {LOGOS.concat(LOGOS).map((name, i) => (
                <div key={i} className={styles.logo} aria-hidden={i >= LOGOS.length}>
                  {name}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 2. Statement */}
      <section className={styles.statement}>
        <StatementReveal text="Give us the job description. We'll handle the rest." />
      </section>

      {/* 3. Stats */}
      <section className={styles.stats}>
        <div className={styles.statGrid}>
          {STATS.map((s) => (
            <div key={s.l} className={styles.statCard}>
              <div className={styles.statNum}>{s.n}</div>
              <div className={styles.statLabel}>{s.l}</div>
            </div>
          ))}
        </div>
      </section>

      {/* 4. Sourcing */}
      <section id={SOURCING.id} className={styles.feature}>
        <div>
          <FeatureText f={SOURCING} />
        </div>
        <div className={styles.media}>
          <Image
            src="https://images.unsplash.com/photo-1732395805034-e0bf859665e5?w=2400&q=85&fit=crop"
            alt="Technician in uniform outside a service building"
            fill
            sizes="(min-width: 1248px) 552px, (min-width: 848px) calc(50vw - 72px), calc(100vw - 48px)"
          />
        </div>
      </section>

      {/* 5. Screening */}
      <section id={SCREENING.id} className={styles.feature}>
        <div className={`${styles.media} ${styles.order1}`}>
          <Image
            src="https://images.unsplash.com/photo-1625148230889-8195e85aae6b?w=2400&q=85&fit=crop"
            alt="Tradesman holding a power tool"
            fill
            sizes="(min-width: 1248px) 552px, (min-width: 848px) calc(50vw - 72px), calc(100vw - 48px)"
          />
        </div>
        <div className={styles.order2}>
          <FeatureText f={SCREENING} />
        </div>
      </section>

      {/* 6. Guarantee */}
      <section id={GUARANTEE.id} className={styles.feature}>
        <div>
          <FeatureText f={GUARANTEE} />
        </div>
        <div className={styles.invoiceCard}>
          <div className={styles.invoiceTop}>
            <span>Invoice timeline</span>
            <span>Day 0 to day 30</span>
          </div>
          <div>
            <div className={styles.tiles}>
              {TIMELINE.map((t) => (
                <div key={t.day} className={styles.tile}>
                  <div className={styles.tileLabel}>{t.day}</div>
                  <div className={styles.tileValue}>{t.amt}</div>
                </div>
              ))}
            </div>
            <div className={styles.track}>
              <div className={styles.trackFill} />
            </div>
          </div>
        </div>
      </section>

      {/* 7. Terms */}
      <section id="offer" className={styles.section}>
        <div className={styles.eyebrow}>The terms, written like an invoice</div>
        <h2 className={`${styles.h2} ${styles.termsH2}`}>You cannot lose money trying us.</h2>
        <p className={styles.lede}>
          Read the line items. Everything is free until the hire is standing in your shop on day 30. If we miss, we pay you.
        </p>
        <div className={styles.termsGrid}>
          <div className={styles.feeCard}>
            <div className={styles.feeHead}>
              <span>The Recruiting Line — Fee schedule</span>
              <span>Per hire</span>
            </div>
            {FEES.map((f) => (
              <div key={f.t} className={styles.feeRow}>
                <div>
                  <div className={styles.feeTitle}>{f.t}</div>
                  <div className={styles.feeDesc}>{f.d}</div>
                </div>
                <div className={styles.feeAmt}>{f.a}</div>
              </div>
            ))}
            <div className={styles.feeFoot}>
              Keep running your own ads the whole time. If your posting beats us to the hire, you owe nothing.
            </div>
          </div>
          <div className={styles.mathStack}>
            <div className={styles.mathLabel}>Do the math on a $70k tech</div>
            <div className={styles.mathCard}>
              <div className={styles.mathCardLabel}>Contingency firm, 20–25% of salary</div>
              <div className={styles.mathCardValue}>$14,000–$17,500</div>
              <div className={styles.mathCardNote}>Unvetted resumes. No guarantee. Due on start date.</div>
            </div>
            <div className={`${styles.mathCard} ${styles.mathCardDark}`}>
              <div className={styles.mathCardLabel}>The Recruiting Line</div>
              <div className={styles.mathCardValue}>$7,500</div>
              <div className={styles.mathCardNote}>Vetted, 30-day replacement, due only after day 30.</div>
            </div>
            <div className={styles.mathCard}>
              <div className={styles.mathCardLabel}>Payback on a filled truck</div>
              <div className={styles.mathCardValue}>7.5 days</div>
              <div className={styles.mathCardNote}>At $1,000 a day of billable revenue the seat was losing.</div>
            </div>
          </div>
        </div>
      </section>

      {/* 8. How it runs */}
      <section id="how" className={styles.how}>
        <div className={styles.container}>
          <div className={styles.eyebrow}>How it runs</div>
          <h2 className={styles.h2}>Built to move at breakdown speed.</h2>
          <div className={styles.stepGrid}>
            {STEPS.map((s) => (
              <div key={s.t} className={styles.stepCard}>
                <div className={styles.stepWhen}>{s.when}</div>
                <div className={styles.stepTitle}>{s.t}</div>
                <p className={styles.stepBody}>{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 9. Fit check */}
      <section id="fit" className={styles.section}>
        <div className={styles.eyebrow}>Fit check</div>
        <h2 className={`${styles.h2} ${styles.fitH2}`}>Who this is for.</h2>
        <div className={styles.fitGrid}>
          <div className={styles.fitCard}>
            <div className={styles.fitTitle}>Open a work order if you are</div>
            <div className={styles.bullets}>
              {FIT_YES.map((b) => (
                <div key={b} className={styles.bullet}>
                  <span className={styles.dot} />
                  <span>{b}</span>
                </div>
              ))}
            </div>
          </div>
          <div className={styles.fitCard}>
            <div className={styles.fitTitle}>We&apos;re the wrong call if you</div>
            <div className={styles.bullets}>
              {FIT_NO.map((b) => (
                <div key={b} className={styles.bullet}>
                  <span className={`${styles.dot} ${styles.dotFaint}`} />
                  <span>{b}</span>
                </div>
              ))}
            </div>
          </div>
          <div className={styles.founderCard}>
            <div className={styles.founderTitle}>First operator in your metro?</div>
            <p className={styles.founderBody}>
              Founding clients get the full service and the full guarantee at $7,500 flat, in exchange for a case study when we fill your seat. One operator per metro. When it&apos;s gone, it&apos;s gone.
            </p>
            <div className={styles.founderPrice}>
              <span className={styles.founderOld}>$12,500</span>
              <span className={styles.founderNew}>$7,500</span>
            </div>
          </div>
        </div>
      </section>

      {/* 10. Start a search */}
      <section id="start" className={styles.start}>
        <div>
          <div className={styles.eyebrow}>The only question that matters</div>
          <h2 className={styles.startH2}>What did the empty seat cost you today?</h2>
          <p className={styles.startSub}>
            Tell us the seat. We call you within one business hour, and you pay nothing until a tech you chose has already worked a month.
          </p>
          <p className={styles.startEmail}>
            Rather talk now?{" "}
            {site.phone ? (
              <>
                Call or text <a href={phoneHref(site.phone)}>{site.phone}</a> or email
              </>
            ) : (
              "Email"
            )}{" "}
            <a href={`mailto:${EMAIL}`}>{EMAIL}</a>.
          </p>
        </div>
        <WorkOrderForm />
      </section>

      {/* 11. Footer */}
      <footer className={styles.footer}>
        <div style={{ minWidth: 0 }}>
          <div className={styles.footerTag}>HVAC &amp; skilled trades recruiting, nationwide.</div>
          <div className={styles.footerMeta}>Pay on hire · 30-day guarantee · No retainers</div>
        </div>
        <div className={styles.footerCol}>
          <div className={styles.footerColHead}>How it works</div>
          <a href="#sourcing">Sourcing</a>
          <a href="#screening">Screening</a>
          <a href="#offer">Terms</a>
          <a href="#how">How it runs</a>
        </div>
        <div className={styles.footerCol}>
          <div className={styles.footerColHead}>Company</div>
          <a href="#fit">Who it&apos;s for</a>
          <a href="#start">Start a search</a>
          <a href={`mailto:${EMAIL}`}>Contact</a>
          <a href="https://www.linkedin.com">LinkedIn</a>
        </div>
        <div className={styles.footerBottom}>
          <span>© 2026 The Recruiting Line</span>
          <span>{EMAIL}</span>
        </div>
      </footer>
    </div>
  );
}
