import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, EyeOff, Timer, Users } from "lucide-react";
import { APP_CONFIG } from "@/lib/ambient";
import { AmbientBackground } from "@/components/presence/layout/AmbientBackground";
import { BrandMark } from "@/components/presence/layout/BrandMark";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Welcome — PresenceTrack AI" },
      {
        name: "description",
        content:
          "Privacy-first workplace presence and dwell-time analytics. Get started with PresenceTrack AI.",
      },
      { property: "og:title", content: "Welcome — PresenceTrack AI" },
      {
        property: "og:description",
        content:
          "Privacy-first workplace presence and dwell-time analytics built for the DPDP Act 2023.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: WelcomePage,
});

const FEATURES = [
  {
    icon: EyeOff,
    title: "No video recorded",
    text: "Camera sensors check presence on the spot and keep only the result — never footage.",
  },
  {
    icon: Timer,
    title: "Live time on the floor",
    text: "See time in the workspace, breaks and zone moves as they happen.",
  },
  {
    icon: Users,
    title: "A console for every role",
    text: "Employees, HR, security and admins each get their own private view.",
  },
];

function WelcomePage() {
  return (
    <div className="relative flex min-h-screen flex-col bg-background">
      <AmbientBackground />

      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
        <div className="flex items-center gap-2.5">
          <BrandMark size="md" />
          <span className="text-base font-extrabold tracking-tight text-umbra">
            PRESENCETRACK <span className="text-emerald-500">AI</span>
          </span>
        </div>
        <Link
          to="/login"
          search={{ mode: "signin" }}
          className="text-sm font-semibold text-sage hover:text-umbra"
        >
          Log in
        </Link>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-5 pb-12 pt-6 sm:px-8">
        <div className="max-w-2xl animate-fade-in">
          <span className="inline-flex items-center gap-2 rounded-full border border-glass-border bg-glass px-3 py-1 text-xs font-semibold text-success-strong backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-success" />
            Built for the DPDP Act 2023
          </span>
          <h1 className="mt-5 text-4xl font-extrabold leading-[1.1] tracking-tight text-umbra sm:text-6xl">
            Presence, measured.
            <br />
            <span className="text-success-strong">Privacy, preserved.</span>
          </h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-sage sm:text-lg">
            Know who is in, where, and for how long — without recording a single frame of video.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link
              to="/login"
              className="glass-btn-primary w-full gap-2 px-7 py-3.5 text-base sm:w-auto"
            >
              Get started
              <ArrowRight className="h-4 w-4" />
            </Link>
            <p className="text-center text-xs text-sage sm:text-left">
              Log in or create your account in a minute.
            </p>
          </div>
        </div>

        <div className="mt-14 grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
          {FEATURES.map(({ icon: Icon, title, text }, i) => (
            <div
              key={title}
              className="stat-card animate-fade-in p-5"
              style={{ animationDelay: `${150 + i * 100}ms` }}
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-success-soft text-success-strong">
                <Icon className="h-4.5 w-4.5" />
              </div>
              <h2 className="mt-3 text-sm font-semibold text-umbra">{title}</h2>
              <p className="mt-1 text-xs leading-relaxed text-sage">{text}</p>
            </div>
          ))}
        </div>
      </main>

      <footer className="relative z-10 px-5 pb-6 text-center text-xs text-sage">
        Certified: DPDP 2023 · CERT-In · OSH Code
      </footer>
    </div>
  );
}
