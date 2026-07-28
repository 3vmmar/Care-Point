import Link from "next/link";

export default function NotFound() {
  return (
    <main className="route-message">
      <span>404</span>
      <h1>This page has moved or never existed.</h1>
      <p>Return to the main experience to explore treatments or reserve a visit.</p>
      <div className="route-message-actions">
        <Link className="button button--burgundy" href="/">
          Return home
        </Link>
      </div>
    </main>
  );
}
