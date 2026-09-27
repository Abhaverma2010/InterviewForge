'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';

export function AppHeader() {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const navLink = (href, label) => (
    <Link
      href={href}
      aria-current={pathname === href ? 'page' : undefined}
      className="rounded-md px-2 py-1 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 aria-[current=page]:text-brand-700"
    >
      {label}
    </Link>
  );

  return (
    <header className="no-print border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link href={user ? '/kits' : '/'} className="text-lg font-bold tracking-tight text-slate-900">
          Interview<span className="text-brand-600">Forge</span>
        </Link>
        {user && (
          <nav aria-label="Main" className="flex flex-wrap items-center gap-1 sm:gap-3">
            {navLink('/kits', 'My kits')}
            {navLink('/kits/new', 'New kit')}
            <span className="hidden text-sm text-slate-500 md:inline" title="Signed in as">
              {user.email}
            </span>
            <button
              type="button"
              onClick={logout}
              className="rounded-md px-2 py-1 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            >
              Log out
            </button>
          </nav>
        )}
      </div>
    </header>
  );
}
