import { list } from '@vercel/blob';

// Fetch generation metadata from Vercel Blob using the share ID.
async function getGeneration(id) {
  try {
    // List blobs with the generations/{id}/ prefix to find the metadata file.
    const { blobs } = await list({ prefix: `generations/${id}/` });
    const metaBlob  = blobs.find(b => b.pathname.endsWith('/meta.json'));
    const imageBlob = blobs.find(b => b.pathname.endsWith('/image.jpg'));
    if (!metaBlob && !imageBlob) return null;

    // If we have metadata, parse it. Otherwise construct a minimal object.
    if (metaBlob) {
      const res  = await fetch(metaBlob.url);
      const data = await res.json();
      return data;
    }
    return { shareId: id, imageUrl: imageBlob.url };
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }) {
  return {
    title: 'Cap Preview — Custom Trucker Cap Design',
    description: 'View a custom trucker cap design preview.',
  };
}

export default async function SharePage({ params }) {
  const { id } = await params;
  const gen = await getGeneration(id);

  if (!gen) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#f5f1e8', fontFamily: 'Newsreader, serif' }}>
        <div className="text-center p-8 max-w-sm">
          <p className="text-2xl mb-3" style={{ fontFamily: 'Anton, sans-serif' }}>PREVIEW NOT FOUND</p>
          <p className="text-sm" style={{ color: '#6b6452' }}>This preview may have expired or the link may be incorrect.</p>
          <a href="/" className="mt-6 inline-block px-6 py-3 text-sm"
            style={{ backgroundColor: '#1a1a1a', color: '#f5f1e8', fontFamily: 'Anton, sans-serif', letterSpacing: '0.05em', textDecoration: 'none' }}>
            CREATE YOUR OWN
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#f5f1e8', fontFamily: 'Newsreader, serif', color: '#1a1a1a' }}>
      <div className="max-w-2xl mx-auto px-6 py-10">
        <header className="mb-8 pb-6" style={{ borderBottom: '1px solid #d6d0c0' }}>
          <div className="text-[10px] tracking-[0.3em] mb-2" style={{ fontFamily: 'JetBrains Mono, monospace', color: '#6b6452' }}>
            CUSTOM CAP STUDIO / PREVIEW
          </div>
          <h1 className="text-4xl" style={{ fontFamily: 'Anton, sans-serif' }}>CAP PREVIEW</h1>
          {gen.createdAt && (
            <p className="text-sm mt-2" style={{ color: '#6b6452', fontStyle: 'italic' }}>
              Created {new Date(gen.createdAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          )}
        </header>

        <div className="border bg-white mb-6" style={{ borderColor: '#1a1a1a' }}>
          <img src={gen.imageUrl} alt="Custom cap preview" className="w-full block" />
        </div>

        {gen.settings && (
          <div className="border bg-white p-4 mb-6" style={{ borderColor: '#d6d0c0' }}>
            <div className="text-[10px] tracking-[0.2em] mb-3" style={{ fontFamily: 'JetBrains Mono, monospace', color: '#6b6452' }}>CAP SPEC</div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {Object.entries(gen.settings.colors || {}).map(([part, colour]) => (
                <div key={part} className="flex items-center gap-2">
                  <div className="w-5 h-5 border flex-shrink-0" style={{ backgroundColor: colour, borderColor: '#d6d0c0' }} />
                  <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.75rem', color: '#6b6452' }}>
                    {part.toUpperCase()} · {colour}
                  </span>
                </div>
              ))}
              {gen.settings.stripeCount > 0 && (
                <div className="flex items-center gap-2 col-span-2">
                  <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.75rem', color: '#6b6452' }}>
                    {gen.settings.stripeCount} STRIPE{gen.settings.stripeCount > 1 ? 'S' : ''}
                  </span>
                </div>
              )}
              {gen.settings.sandwichBrim && (
                <div className="flex items-center gap-2 col-span-2">
                  <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.75rem', color: '#6b6452' }}>SANDWICH BRIM</span>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="flex gap-3 flex-wrap">
          <a href={gen.imageUrl} download target="_blank" rel="noopener noreferrer"
            className="px-5 py-3 flex items-center gap-2 text-sm"
            style={{ backgroundColor: '#1a1a1a', color: '#f5f1e8', fontFamily: 'Anton, sans-serif', letterSpacing: '0.05em', textDecoration: 'none' }}>
            DOWNLOAD
          </a>
          <a href="/"
            className="px-5 py-3 flex items-center gap-2 text-sm"
            style={{ backgroundColor: '#c2410c', color: '#fff', fontFamily: 'Anton, sans-serif', letterSpacing: '0.05em', textDecoration: 'none' }}>
            CREATE YOUR OWN
          </a>
        </div>
      </div>
    </div>
  );
}
