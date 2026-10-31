import Link from "next/link";
import PublicRequirementsExplorer from "@/components/portal/public-requirements-explorer";

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div>
            <h1 className="text-lg font-bold text-blue-950 sm:text-xl">Oromia Police College</h1>
            <p className="text-xs text-slate-500 sm:text-sm">Requirements Management Portal</p>
          </div>
          <Link href="/login" className="shrink-0 rounded-lg bg-blue-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">Staff Login</Link>
        </div>
      </header>
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        <PublicRequirementsExplorer />
      </div>
    </main>
  );
}
