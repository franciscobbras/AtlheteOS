'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LABEL_MAP: Record<string, string> = {
  dashboard: 'Training',
  nutrition: 'Nutrition',
  life: 'Life',
  student: 'Student',
  live: 'Live',
  upload: 'Upload',
  activities: 'Activities',
  detail: 'Detail',
  new: 'New',
};

function capitalize(s: string): string {
  return LABEL_MAP[s] ?? s.charAt(0).toUpperCase() + s.slice(1);
}

export default function Breadcrumb() {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);

  if (segments.length === 0) return null;

  const crumbs = segments.map((seg, i) => {
    const href = '/' + segments.slice(0, i + 1).join('/');
    const label = capitalize(seg);
    const isLast = i === segments.length - 1;
    return { href, label, isLast };
  });

  return (
    <nav className="breadcrumb" aria-label="Breadcrumb">
      <Link href="/">Home</Link>
      {crumbs.map((c) => (
        <span key={c.href} style={{ display: 'contents' }}>
          <span className="breadcrumb-sep">›</span>
          {c.isLast ? (
            <span className="breadcrumb-current">{c.label}</span>
          ) : (
            <Link href={c.href}>{c.label}</Link>
          )}
        </span>
      ))}
    </nav>
  );
}
