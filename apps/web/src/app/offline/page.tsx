export default function OfflinePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 text-center">
      <h1 className="text-2xl font-semibold">You are offline</h1>
      <p className="text-muted-foreground">
        Margot needs an internet connection to sync your marketing data.
        <br />
        Check your connection and try again.
      </p>
    </div>
  );
}
