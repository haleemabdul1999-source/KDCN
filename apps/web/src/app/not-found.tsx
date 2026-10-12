import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="empty">
      <h1>Page not found</h1>
      <p>The page you are looking for doesn&apos;t exist or is no longer available.</p>
      <Link className="btn" href="/">
        Back to KDCN
      </Link>
    </div>
  );
}
