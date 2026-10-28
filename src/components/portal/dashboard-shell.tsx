"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Role = "ADMIN" | "REVIEWER" | "APPROVER";

type User = {
  id: string;
  full_name: string;
  email: string;
  role_code: Role;
};

type MenuItem = {
  label: string;
  href: string;
  roles: Role[];
};

const menu: MenuItem[] = [
  {
    label: "Dashboard",
    href: "/dashboard",
    roles: ["ADMIN", "REVIEWER", "APPROVER"],
  },
  {
    label: "Institutional Modules",
    href: "/modules",
    roles: ["ADMIN", "REVIEWER", "APPROVER"],
  },
  {
    label: "Proposal Reviews",
    href: "/reviews",
    roles: ["ADMIN", "REVIEWER", "APPROVER"],
  },
  {
    label: "Approvals",
    href: "/approvals",
    roles: ["ADMIN", "APPROVER"],
  },
  {
    label: "User Management",
    href: "/users",
    roles: ["ADMIN"],
  },
  {
    label: "Reports",
    href: "/reports",
    roles: ["ADMIN", "REVIEWER", "APPROVER"],
  },
  {
    label: "Audit History",
    href: "/audit",
    roles: ["ADMIN"],
  },
];

export default function DashboardShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadUser() {
      try {
        const response = await fetch("/api/auth/me", {
          cache: "no-store",
        });

        if (!response.ok) {
          router.replace("/login");
          return;
        }

        const data = await response.json();

        if (!data.user) {
          router.replace("/login");
          return;
        }

        if (active) {
          setUser(data.user);
        }
      } catch {
        router.replace("/login");
      } finally {
        if (active) setLoading(false);
      }
    }

    loadUser();

    return () => {
      active = false;
    };
  }, [router]);

  async function logout() {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
      });
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 text-slate-600">
        Checking your account...
      </div>
    );
  }

  const allowedMenu = menu.filter((item) =>
    item.roles.includes(user.role_code)
  );

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200 bg-white px-4 shadow-sm md:px-8">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="rounded-lg border border-slate-300 px-3 py-2 md:hidden"
            aria-label="Toggle navigation"
          >
            ☰
          </button>

          <div>
            <h1 className="font-bold text-blue-950">
              Oromia Police College
            </h1>
            <p className="text-xs text-slate-500">
              Requirements Gathering and Approval Portal
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden text-right sm:block">
            <p className="text-sm font-semibold">
              {user.full_name}
            </p>
            <p className="text-xs text-slate-500">
              {user.role_code}
            </p>
          </div>

          <button
            onClick={logout}
            className="rounded-lg bg-red-50 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100"
          >
            Logout
          </button>
        </div>
      </header>

      <div className="flex">
        <aside
          className={`fixed bottom-0 left-0 top-16 z-20 w-64 border-r border-slate-200 bg-white p-4 md:sticky md:top-16 md:h-[calc(100vh-4rem)] ${
            sidebarOpen ? "block" : "hidden md:block"
          }`}
        >
          <p className="mb-4 px-3 text-xs font-bold uppercase tracking-wider text-slate-400">
            Main Navigation
          </p>

          <nav className="space-y-1">
            {allowedMenu.map((item) => {
              const selected =
                pathname === item.href ||
                pathname.startsWith(item.href + "/");

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setSidebarOpen(false)}
                  className={`block rounded-lg px-4 py-3 text-sm font-medium transition ${
                    selected
                      ? "bg-blue-900 text-white"
                      : "text-slate-600 hover:bg-blue-50 hover:text-blue-900"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="mt-10 rounded-xl bg-blue-50 p-4">
            <p className="text-xs font-semibold text-blue-900">
              Signed in as
            </p>
            <p className="mt-1 break-words text-sm text-slate-700">
              {user.email}
            </p>
          </div>
        </aside>

        <main className="min-w-0 flex-1 p-5 md:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
