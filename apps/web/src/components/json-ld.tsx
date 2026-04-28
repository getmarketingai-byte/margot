/**
 * Renders one or more JSON-LD documents inside a page. Use in server
 * components only (server-rendered <script> tags are what crawlers see).
 */

type JsonLd = Record<string, unknown>;

export function JsonLd({ data }: { data: JsonLd | ReadonlyArray<JsonLd> }) {
  const docs = Array.isArray(data) ? data : [data];
  return (
    <>
      {docs.map((doc, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(doc) }}
        />
      ))}
    </>
  );
}
