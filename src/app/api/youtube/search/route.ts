import { NextResponse } from 'next/server';
import ytSearch from 'yt-search';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');

  if (!query) {
    return NextResponse.json({ error: 'Search query is required' }, { status: 400 });
  }

  try {
    const result = await ytSearch(query + ' audio');
    
    if (result.videos && result.videos.length > 0) {
      return NextResponse.json({ videoId: result.videos[0].videoId });
    }
    
    return NextResponse.json({ error: 'No video found' }, { status: 404 });
  } catch (error: any) {
    console.error('YouTube Search Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
