import { NextResponse } from 'next/server';

// In-memory store for active users
// Note: This works perfectly for local development or a traditional Node.js server.
// If deploying to a serverless environment like Vercel, you would typically use 
// Redis (like Upstash) or Pusher since serverless functions don't share memory.
const activeUsers = new Map<string, number>();

export async function POST(req: Request) {
  try {
    const { userId } = await req.json();
    const now = Date.now();
    
    if (userId) {
      activeUsers.set(userId, now);
    }
    
    // Clean up users who haven't pinged in the last 15 seconds
    for (const [id, lastPing] of activeUsers.entries()) {
      if (now - lastPing > 15000) {
        activeUsers.delete(id);
      }
    }
    
    return NextResponse.json({ count: activeUsers.size });
  } catch (error) {
    return NextResponse.json({ count: 1 }, { status: 500 });
  }
}
