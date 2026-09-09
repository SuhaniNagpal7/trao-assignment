'use client';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return <main className="standalone"><h1>We couldn’t open your workspace.</h1><p>The service may be temporarily unavailable. Your saved courses are safe.</p><button className="primary" onClick={reset}>Try again</button></main>;
}
