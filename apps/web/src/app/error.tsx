'use client';

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="empty">
      <h1>Something went wrong</h1>
      <p>We couldn&apos;t load this page. Please check your connection and try again.</p>
      <button className="btn" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
