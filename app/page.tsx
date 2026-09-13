import Ticker from "./Ticker";
import LeadForm from "./LeadForm";
import { site, phoneHref } from "./site";

export default function Home() {
  return (
    <>
      <div className="hazard" aria-hidden="true" />
      <nav>
        <div className="nav-in">
          <a className="logo" href="#top">
            The <span>Recruiting</span> Line
          </a>
          <a className="nav-cta" href="#start">
            Start a search
          </a>
        </div>
      </nav>

      <header className="wrap hero" id="top">
        <div>
          <span className="eyebrow">
            HVAC tech recruiting for home services operators
          </span>
          <h1>
            A vetted tech on your truck in <em>7 days.</em> You pay after his
            first 30.
          </h1>
          <p className="sub">
            Every day that seat sits open, your posting sits on Indeed and your
            revenue sits in a parked truck. We fill it fast, guarantee it for
            30 days, and you owe nothing until the hire has already proven
            out.
          </p>
          <div className="hero-ctas">
            <a className="btn btn-primary" href="#start">
              Start a search
            </a>
            <a className="btn btn-ghost" href="#offer">
              See the terms
            </a>
          </div>
          <p className="hero-note">
            No retainers. No percentage math. No invoice until day 30.
          </p>
        </div>

        <div
          className="workorder"
          aria-label="Cost of your open seat, running total"
        >
          <span className="stamp">Unfilled</span>
          <div className="wo-head">
            <span className="t">Work order: open seat</span>
            <span className="n">WO-0047</span>
          </div>
          <div className="wo-body">
            <div className="wo-row">
              <span className="l">Role</span>
              <span className="v">HVAC Service Tech</span>
            </div>
            <div className="wo-row">
              <span className="l">Posted on job boards</span>
              <span className="v">47 days ago</span>
            </div>
            <div className="wo-row">
              <span className="l">Billable revenue / truck / day</span>
              <span className="v">$1,000&ndash;$2,500</span>
            </div>
            <div className="wo-total">
              <div className="lbl">Revenue forgone while you read this page</div>
              <div className="amt">
                <Ticker />
              </div>
              <div className="per">
                and counting, at roughly $1,000 per open-seat day
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="strip">
        <div className="wrap in">
          <div className="stat">
            <div className="num">
              <b>110,000</b>
            </div>
            <div className="lab">Open HVAC tech seats in the US</div>
          </div>
          <div className="stat">
            <div className="num">45&ndash;90</div>
            <div className="lab">Days the average seat sits empty</div>
          </div>
          <div className="stat">
            <div className="num">
              <b>7</b>
            </div>
            <div className="lab">Days until we present candidates</div>
          </div>
          <div className="stat">
            <div className="num">30</div>
            <div className="lab">Day replacement guarantee</div>
          </div>
        </div>
      </div>

      <section className="wrap" id="offer">
        <span className="eyebrow">The terms, written like an invoice</span>
        <h2>You cannot lose money trying us.</h2>
        <p className="lede">
          Read the line items. Everything is free until the hire is standing in
          your shop on day 30. If we miss, we pay you.
        </p>

        <div className="invoice">
          <div className="inv-head">
            <span>The Recruiting Line &mdash; Fee schedule</span>
            <span>Per hire</span>
          </div>
          <div className="inv-line">
            <span className="what">
              <b>Search opened, seat briefed</b>
              <span className="fine">
                15-minute call. We map the role, pay band, certs, and
                territory.
              </span>
            </span>
            <span className="due zero">$0</span>
          </div>
          <div className="inv-line">
            <span className="what">
              <b>Vetted candidates presented within 7 days</b>
              <span className="fine">
                Licensed, screened, reference-checked, ready to interview.
              </span>
            </span>
            <span className="due zero">$0</span>
          </div>
          <div className="inv-line">
            <span className="what">
              <b>You hire. We negotiate the offer, set the start date.</b>
              <span className="fine">
                He shows up day one. Still nothing due.
              </span>
            </span>
            <span className="due zero">$0</span>
          </div>
          <div className="inv-line">
            <span className="what">
              <b>Hire completes his first 30 days</b>
              <span className="fine">
                The only line you ever pay, and only once he has proven out.
              </span>
            </span>
            <span className="due pay">$7,500</span>
          </div>
          <div className="inv-line">
            <span className="what">
              <b>We miss the 7-day candidate deadline</b>
              <span className="fine">
                No vetted candidates on your desk by day 7 and the miss is on
                us. Search continues, and you get paid for the wait.
              </span>
            </span>
            <span className="due credit">we pay you $500</span>
          </div>
          <div className="inv-line">
            <span className="what">
              <b>He leaves or you fire him inside 30 days</b>
              <span className="fine">
                We replace him free. As many times as it takes.
              </span>
            </span>
            <span className="due zero">$0</span>
          </div>
          <div className="inv-foot">
            <span className="terms">
              Keep running your own ads the whole time. If your posting beats
              us to the hire, you owe nothing.
            </span>
            <a className="btn btn-primary" href="#start">
              Open a work order
            </a>
          </div>
        </div>

        <div className="math">
          <span className="eyebrow">Do the math on a $70k tech</span>
          <div className="math-grid">
            <div className="math-col">
              <div className="math-lab">Contingency firm, 20&ndash;25% of salary</div>
              <div className="math-num">$14,000&ndash;$17,500</div>
              <div className="math-fine">Unvetted resumes. No guarantee. Due on start date.</div>
            </div>
            <div className="math-col hot">
              <div className="math-lab">The Recruiting Line</div>
              <div className="math-num">$7,500</div>
              <div className="math-fine">Vetted, 30-day replacement, due only after day 30.</div>
            </div>
            <div className="math-col">
              <div className="math-lab">Payback on a filled truck</div>
              <div className="math-num">7.5 days</div>
              <div className="math-fine">At $1,000 a day of billable revenue the seat was losing.</div>
            </div>
          </div>
        </div>
      </section>

      <section className="wrap">
        <span className="eyebrow">How it runs</span>
        <h2>Built to move at breakdown speed.</h2>
        <div className="steps">
          <div className="step">
            <span className="day">Day 0</span>
            <h3>Brief the seat</h3>
            <p>
              One 15-minute call. Role, certs, pay band, territory, what the
              last guy got wrong.
            </p>
          </div>
          <div className="step">
            <span className="day">Days 1&ndash;7</span>
            <h3>We hunt</h3>
            <p>
              Applicants and passive techs screened the same day they surface,
              day or night. You see only the ones worth your time.
            </p>
          </div>
          <div className="step">
            <span className="day">Days 7&ndash;14</span>
            <h3>Interview &amp; offer</h3>
            <p>
              We schedule everything inside 48 hours and negotiate the offer so
              it sticks. Deals die in the gaps; we don&apos;t leave gaps.
            </p>
          </div>
          <div className="step">
            <span className="day">Days 1&ndash;30</span>
            <h3>He proves out or we replace him</h3>
            <p>
              Check-ins at day 7 and day 30. If it breaks inside the first 30
              days, we run it again for free.
            </p>
          </div>
        </div>
      </section>

      <section className="wrap">
        <span className="eyebrow">Fit check</span>
        <h2>Who this is for.</h2>
        <div className="fit">
          <div className="fit-col yes">
            <h3>Open a work order if you are</h3>
            <ul>
              <li>
                A multi-location or PE-backed home services operator with an
                approved, open tech seat
              </li>
              <li>
                An independent shop where an empty truck is costing you jobs
                this week
              </li>
              <li>
                Tired of paying 20&ndash;25% of salary for unvetted resumes and
                no guarantee
              </li>
              <li>
                Ready to interview within 48 hours of seeing a candidate
              </li>
            </ul>
          </div>
          <div className="fit-col no">
            <h3>We&apos;re the wrong call if you</h3>
            <ul>
              <li>
                Want to &quot;build a pipeline&quot; with no approved hire
                behind it
              </li>
              <li>Need temp day labor rather than a permanent tech</li>
              <li>
                Pay under market and want a recruiter to talk someone into it
              </li>
              <li>Take three weeks to schedule an interview</li>
            </ul>
          </div>
        </div>

        <div className="founder">
          <div>
            <h3>First operator in your metro?</h3>
            <p>
              Founding clients get the full service and the full guarantee at
              $7,500 flat, in exchange for a case study when we fill your seat.
              One operator per metro. When it&apos;s gone, it&apos;s gone.
            </p>
          </div>
          <div className="price">
            <s>$12,500</s>$7,500
          </div>
        </div>
      </section>

      <section className="final" id="start">
        <div className="wrap">
          <span className="eyebrow" style={{ color: "#7FB2C0" }}>
            The only question that matters
          </span>
          <h2>
            What did the empty seat cost you <em>today?</em>
          </h2>
          <p className="lede">
            Tell us the seat. We call you within one business hour, and you pay
            nothing until a tech you chose has already worked a month.
          </p>
          <LeadForm />
          <p className="final-alt">
            Rather talk now?{" "}
            {site.phone && (
              <>
                Call or text <a href={phoneHref(site.phone)}>{site.phone}</a>
                {" "}or{" "}
              </>
            )}
            email <a href={"mailto:" + site.email}>{site.email}</a>.
          </p>
        </div>
      </section>

      <footer>
        <div className="foot-in">
          <span>
            The Recruiting Line &mdash; HVAC &amp; skilled trades recruiting,
            nationwide
          </span>
          <span>
            Pay on hire &middot; 30-day guarantee &middot; No retainers
          </span>
        </div>
      </footer>
    </>
  );
}
