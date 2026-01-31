import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  component: HomePage,
});

function HomePage() {
  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Music Tools</h1>
        <p className="text-muted-foreground">A collection of browser-based music utilities.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Add tool cards here as you build features */}
        <div className="rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm">
          <h3 className="font-semibold">Getting Started</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Add your music tools by creating new routes in the{' '}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">src/routes</code> directory.
          </p>
        </div>
      </div>
    </div>
  );
}
