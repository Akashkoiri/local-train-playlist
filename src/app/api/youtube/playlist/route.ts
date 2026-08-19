import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const playlistId = searchParams.get('id') || process.env.NEXT_PUBLIC_YOUTUBE_PLAYLIST_ID;
  const apiKey = process.env.YOUTUBE_API_KEY;

  if (!playlistId) {
    return NextResponse.json({ error: 'Playlist ID is required' }, { status: 400 });
  }

  if (!apiKey) {
    return NextResponse.json({ error: 'YouTube API Key missing' }, { status: 500 });
  }

  try {
    const res = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&maxResults=50&playlistId=${playlistId}&key=${apiKey}`);
    
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`YouTube API Error: ${errText || res.statusText}`);
    }

    const data = await res.json();
    
    // Format the response for our frontend
    const tracks = data.items.map((item: any) => ({
      id: item.snippet.resourceId.videoId,
      title: item.snippet.title,
      artist: item.snippet.videoOwnerChannelTitle || 'YouTube',
      albumArt: item.snippet.thumbnails?.maxres?.url || item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.default?.url,
      durationMs: 0 // Duration will be determined by the YouTube player on the client side
    })).filter((t: any) => t.title && t.title !== 'Private video');

    return NextResponse.json({
      name: 'YouTube Playlist',
      tracks: tracks
    });
  } catch (error: any) {
    console.error('YouTube API Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
