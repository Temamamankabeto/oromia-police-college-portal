import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <div>
            <h1 className="text-xl font-bold text-blue-950">
              Oromia Police College
            </h1>
            <p className="text-sm text-slate-500">
              Requirements Gathering and Approval Portal
            </p>
          </div>

          <Link
            href="/login"
            className="rounded-lg bg-blue-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-800"
          >
            Staff Login
          </Link>
        </div>
      </header>

      <section className="mx-auto grid max-w-7xl gap-10 px-6 py-20 lg:grid-cols-2 lg:items-center">
        <div>
          <span className="rounded-full bg-blue-100 px-4 py-2 text-sm font-medium text-blue-900">
            Institutional Requirements Management
          </span>

          <h2 className="mt-7 text-4xl font-bold leading-tight text-blue-950 md:text-5xl">
            Digital Requirements Gathering and Approval System
          </h2>

          <p className="mt-6 max-w-xl text-lg leading-8 text-slate-600">
            A centralized digital platform for gathering institutional
            requirements, reviewing submissions, providing
            feedback, tracking revisions, and approving
            requirements through a structured workflow.
          </p>

          <div className="mt-8 flex flex-wrap gap-4">
            <Link
              href="/login"
              className="rounded-lg bg-blue-900 px-6 py-3 font-semibold text-white hover:bg-blue-800"
            >
              Access Portal
            </Link>

            <Link
              href="/modules"
              className="rounded-lg border border-blue-900 px-6 py-3 font-semibold text-blue-900 hover:bg-blue-50"
            >
              View Modules
            </Link>
          </div>
        </div>

        <div className="rounded-3xl bg-gradient-to-br from-blue-950 to-blue-700 p-10 text-white shadow-xl">
          <h3 className="text-2xl font-bold">
            Portal Capabilities
          </h3>

          <div className="mt-8 space-y-5">
            {[
              "32 Institutional Modules",
              "Requirements Collection and Management",
              "Requirements Review and Feedback",
              "Requirements Revision Tracking",
              "Requirements Approval Workflow",
              "Requirements Reports and Audit History",
            ].map((feature) => (
              <div
                key={feature}
                className="flex items-center gap-3 rounded-xl bg-white/10 p-4"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/20">
                  ✓
                </span>
                <span className="font-medium">{feature}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-200 bg-white px-6 py-6 text-center text-sm text-slate-500">
        Oromia Police College — Requirements Gathering and Approval Portal
      </footer>
    </main>
  );
}
