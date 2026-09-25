import { createFileRoute, Link } from "@tanstack/react-router";
import { Clock, CheckCircle2, XCircle, ExternalLink, GitBranch, Send, Eye } from "lucide-react";

export const Route = createFileRoute("/assignment")({
  head: () => ({
    meta: [
      { title: "Hiring Assignment · Activate 3 Modules End-to-End" },
      {
        name: "description",
        content:
          "Hiring assignment: copy this rental CRM from GitHub, take any three modules end-to-end to a 2-3x level, and send us the live link.",
      },
      { property: "og:title", content: "Hiring Assignment · Activate 3 Modules End-to-End" },
      {
        property: "og:description",
        content:
          "Copy the project from GitHub, deepen any three modules end-to-end, and share your live link with us.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AssignmentPage,
});

const modules = [
  {
    name: "M-POWER CALL (Call Conversation Engine)",
    where: "/leads — open a lead, press M-POWER CALL",
    does: "Runs a real call: why we are calling, what is already known, what to confirm, what to say, and what gets written back after the call.",
  },
  {
    name: "Movement CARE (daily draft + result promise)",
    where: "/movement-care",
    does: "A person promises a result for the day, picks 30 leads one by one, works them, and closes the day with a WhatsApp update.",
  },
  {
    name: "Booking Flow Split (operator workspace)",
    where: "/booking-flow-split",
    does: "One screen split for WhatsApp on one side and the CRM on the other: questions, answers, next step, deadline, closing promise.",
  },
  {
    name: "Movement OS",
    where: "/movement-os",
    does: "The full customer list with stages, owners, overdue work and the work panel beside it.",
  },
  // Admin Movement Control removed from the recommended modules list for this submission.
  {
    name: "Closing desk",
    where: "/closing",
    does: "Everyone past the tour: quote, decision, booking, money pending, check-in, with promised closing times.",
  },
];

const questions = [
  {
    q: "What result does this module produce?",
    how: "Name the outcome in one line, e.g. \"more tours actually happen\". Put that line on the screen so the person using it sees it.",
  },
  {
    q: "Who is accountable, and by when?",
    how: "Every item must carry an owner and a deadline. Show what is late in red, on the same screen, not in a report.",
  },
  {
    q: "What is the smallest number of clicks to finish one customer?",
    how: "Count the clicks today. Cut them at least in half. Typing should save itself; Enter should move forward.",
  },
  {
    q: "What gets captured, and can I see it without scrolling?",
    how: "Everything already filled stays visible while working. Nothing should need a second page to read.",
  },
  {
    q: "What happens after the work is done?",
    how: "Auto-write the customer message, the follow-up and the next step. The person should only copy and send.",
  },
  {
    q: "Where does the data go?",
    how: "Save to the hosted backend, not just the browser, so the same state shows on another device and to the admin.",
  },
  {
    q: "How do I prove it works?",
    how: "Walk one real customer through the whole module and show the trail: what changed, who changed it, at what time.",
  },
];

const evaluation = [
  { label: "Outcome depth on the three modules", weight: "40%", note: "Did each module actually finish the work it claims — end to end, not a coat of paint?" },
  { label: "Click and scroll reduction", weight: "20%", note: "Measured before/after on one real customer. Numbers, not adjectives." },
  { label: "Nothing broken", weight: "20%", note: "Every existing button, option and page still works. Regression is disqualifying." },
  { label: "Data integrity", weight: "10%", note: "Saves survive refresh and another device. One customer = one record everywhere." },
  { label: "Clarity of your note", weight: "10%", note: "Can a non-technical founder understand what you did in 60 seconds?" },
];

const rulesGood = [
  "Pick 3 modules and go deep — depth beats spread every time.",
  "Count clicks on one real customer before you change anything. That number is your baseline.",
  "Keep the app running at every step. A broken live link scores zero.",
  "Reuse the patterns already in the codebase — semantic tokens, TanStack routes, the existing event trail.",
];

const rulesBad = [
  "Do not redesign the brand, colors or layout system — we judge outcomes, not taste.",
  "Do not add new pages that duplicate an existing module.",
  "Do not leave empty screens or decorative buttons. If it renders, it must work.",
  "Do not submit code without a live link. We judge the live link, not the code style.",
];

const timeline = [
  { when: "Hour 0–1", what: "Open the app, click through all six modules, pick your three." },
  { when: "Hour 1–2", what: "Copy the repo, run it locally, publish an empty deploy so the link works early." },
  { when: "Hour 2–10", what: "Module by module: baseline clicks → build → verify in the browser." },
  { when: "Final hour", what: "Regression pass on everything you didn't touch, write the note, send the link." },
];

export default function AssignmentPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-4xl px-5 py-10 space-y-12">
        <header className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="rounded-full border border-border bg-muted px-3 py-1 text-xs uppercase tracking-widest text-muted-foreground">
              Hiring assignment
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" /> 10–12 focused hours
            </span>
            <span className="rounded-full border border-border bg-muted px-3 py-1 text-xs text-muted-foreground">
              Pick 3 of 6 modules
            </span>
          </div>
          <h1 className="text-3xl font-bold leading-tight sm:text-4xl">
            Take any three modules end-to-end, 2–3x deeper
          </h1>
          <p className="text-muted-foreground max-w-3xl">
            This is a live rental CRM used by a team that finds homes for people and closes
            bookings. Your job is not to redesign it. Your job is to pick three modules and make
            them actually finish the work they claim to do. Everything below tells you exactly what
            "finish" means, how you will be scored, and how to submit.
          </p>
          <div className="rounded-lg border border-border bg-card p-4 text-sm space-y-1">
            <p className="font-semibold">Start here — two minutes</p>
            <p className="text-muted-foreground">
              1. Click through the product below so you know what exists. &nbsp;2. Copy the GitHub
              repo and get it running. &nbsp;3. Pick your three modules and build. The full order of
              operations is in <span className="font-medium text-foreground">Submit</span> at the
              bottom.
            </p>
          </div>
        </header>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">What this product is</h2>
          <p className="text-sm text-muted-foreground">
            A customer comes in from WhatsApp. Someone calls them, understands what they need,
            matches a property, schedules a tour, gets a decision, takes the booking, collects the
            money and hands over the keys. Every screen here exists to move one customer one step
            forward, with a named owner and a deadline. The same customer is the same record
            everywhere — the list, the call screen, the work panel and the admin room all read one
            truth.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Pick any three</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {modules.map((m) => (
              <div key={m.name} className="rounded-lg border border-border bg-card p-4 space-y-1">
                <p className="font-medium">{m.name}</p>
                <p className="text-sm text-muted-foreground">{m.does}</p>
                <p className="text-xs text-muted-foreground">{m.where}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">
            Answer these for each module you pick
          </h2>
          <ol className="space-y-3">
            {questions.map((item, i) => (
              <li key={item.q} className="rounded-lg border border-border bg-card p-4">
                <p className="font-medium">
                  {i + 1}. {item.q}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">How: </span>
                  {item.how}
                </p>
              </li>
            ))}
          </ol>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">What 2–3x means here</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>Half the clicks for the same outcome, or less.</li>
            <li>No empty screen and no screen that asks only one question.</li>
            <li>Nothing silently lost — every edit shows who, what and when.</li>
            <li>
              The customer message, the follow-up and the next step are written for the person, not
              by the person.
            </li>
            <li>Admin can see the exact same state the operator is seeing.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">How you will be scored</h2>
          <div className="rounded-lg border border-border overflow-hidden">
            <div className="divide-y divide-border">
              {evaluation.map((e) => (
                <div key={e.label} className="flex items-start gap-3 px-4 py-3 bg-card">
                  <span className="w-12 shrink-0 font-mono text-sm font-semibold text-accent">
                    {e.weight}
                  </span>
                  <div>
                    <p className="text-sm font-medium">{e.label}</p>
                    <p className="text-xs text-muted-foreground">{e.note}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-border bg-card p-4 space-y-2">
            <p className="font-medium inline-flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-success" /> Do this
            </p>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {rulesGood.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg border border-border bg-card p-4 space-y-2">
            <p className="font-medium inline-flex items-center gap-2">
              <XCircle className="h-4 w-4 text-destructive" /> Don't do this
            </p>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {rulesBad.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Suggested working rhythm</h2>
          <div className="rounded-lg border border-border divide-y divide-border overflow-hidden">
            {timeline.map((t) => (
              <div key={t.when} className="flex items-start gap-3 px-4 py-3 bg-card">
                <span className="w-20 shrink-0 text-xs font-mono text-muted-foreground pt-0.5">
                  {t.when}
                </span>
                <p className="text-sm text-muted-foreground">{t.what}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Submit</h2>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
            <li>Copy the project from GitHub into your own account.</li>
            <li>
              Build your changes on the three modules you chose. Keep the existing buttons and
              options working.
            </li>
            <li>Publish it and get a live link that we can open.</li>
            <li>
              Send us the live link plus a short note using the format below.
            </li>
          </ol>
          <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm space-y-3">
            <p className="font-medium inline-flex items-center gap-2">
              <GitBranch className="h-4 w-4" /> Repository
            </p>
            <a
              className="text-primary underline break-all inline-flex items-center gap-1"
              href="https://github.com/Gharpayytechy/lead-zen-cleaner"
              target="_blank"
              rel="noreferrer"
            >
              github.com/Gharpayytechy/lead-zen-cleaner <ExternalLink className="h-3 w-3" />
            </a>
            <p className="font-medium inline-flex items-center gap-2 pt-2">
              <Send className="h-4 w-4" /> Your note — copy this format
            </p>
            <pre className="rounded-md border border-border bg-background p-3 text-xs whitespace-pre-wrap font-mono text-muted-foreground">{`Live link: <your published URL>
Modules picked: 1) … 2) … 3) …
For each module:
  - Before: <clicks/scrolls to finish one customer>
  - After:  <clicks/scrolls>
  - What I changed: <2 lines>
  - Where to see it: <exact page + what to click>
One customer walkthrough: <name, and the trail of who/what/when>`}</pre>
            <p className="text-muted-foreground inline-flex items-start gap-1.5">
              <Eye className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              We judge the live link, not the code style. If it does not work in the browser, it
              does not count.
            </p>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">See the product first</h2>
          <div className="flex flex-wrap gap-2">
            {[
              { to: "/leads", label: "Leads" },
              { to: "/movement-care", label: "Movement CARE" },
                { to: "/booking-flow-split", label: "Booking Flow Split" },
                { to: "/closing", label: "Closing desk" },
            ].map((l) => (
              <Link
                key={l.to}
                to={l.to}
                className="rounded-md border border-border bg-card px-3 py-2 text-sm hover:bg-accent"
              >
                {l.label}
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
