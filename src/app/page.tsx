'use client';

import { useState, useEffect, useRef } from 'react';
import YouTube, { YouTubeEvent, YouTubePlayer } from 'react-youtube';
import { Sekuya } from 'next/font/google';

const sekuya = Sekuya({ weight: '400', subsets: ['latin'] });

type Track = {
  id: string;
  title: string;
  artist: string;
  albumArt: string;
  durationMs: number;
};

const extractPlaylistId = (input: string) => {
  const trimmed = input.trim();
  if (!trimmed) return '';
  
  try {
    const url = new URL(trimmed);
    return url.searchParams.get('list') || trimmed;
  } catch (e) {
    const listMatch = trimmed.match(/[?&]list=([a-zA-Z0-9_-]+)/);
    if (listMatch) {
      return listMatch[1];
    }
    return trimmed;
  }
};

export default function Home() {
  const [time, setTime] = useState('');
  
  // Data state
  const [playlist, setPlaylist] = useState<Track[]>([]);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
  const [youtubeVideoId, setYoutubeVideoId] = useState<string | null>(null);
  
  // Player state
  const [isPlaying, setIsPlaying] = useState(false);
  const [isShuffle, setIsShuffle] = useState(false);
  const [repeatMode, setRepeatMode] = useState<0 | 1 | 2>(0);
  const [progress, setProgress] = useState(0); // in seconds
  const [duration, setDuration] = useState(0); // in seconds
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // YT Menu state
  const [showYtMenu, setShowYtMenu] = useState(false);
  const ytMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (ytMenuRef.current && !ytMenuRef.current.contains(event.target as Node)) {
        setShowYtMenu(false);
      }
    };

    if (showYtMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showYtMenu]);

  // Lyrics state
  const [showLyrics, setShowLyrics] = useState(false);
  const [lyrics, setLyrics] = useState<string | null>(null);
  const [syncedLyrics, setSyncedLyrics] = useState<{ time: number; text: string }[] | null>(null);
  const [activeLineIndex, setActiveLineIndex] = useState(-1);
  const [isLyricsLoading, setIsLyricsLoading] = useState(false);
  const [lyricsError, setLyricsError] = useState<string | null>(null);

  // Search state
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const lyricsContainerRef = useRef<HTMLDivElement>(null);

  const parseSyncedLyrics = (lrc: string) => {
    const lines = lrc.split('\n');
    const parsed = [];
    for (const line of lines) {
      const match = line.match(/\[(\d{2}):(\d{2}(?:\.\d{1,3})?)\](.*)/);
      if (match) {
        const minutes = parseInt(match[1]);
        const seconds = parseFloat(match[2]);
        const text = match[3].trim();
        parsed.push({ time: minutes * 60 + seconds, text });
      }
    }
    return parsed;
  };

  const stateRef = useRef({ isShuffle, repeatMode, currentTrackIndex, playlist });
  useEffect(() => {
    stateRef.current = { isShuffle, repeatMode, currentTrackIndex, playlist };
  }, [isShuffle, repeatMode, currentTrackIndex, playlist]);

  const playerRef = useRef<YouTubePlayer | null>(null);
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Time clock
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTime(now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }));
    };
    updateTime();
    const timer = setInterval(updateTime, 60000);
    return () => clearInterval(timer);
  }, []);

  // Fetch lyrics when needed
  useEffect(() => {
    if (!showLyrics || playlist.length === 0) return;
    
    const fetchLyrics = async () => {
      const track = playlist[currentTrackIndex];
      const cleanArtist = track.artist.replace(/VEVO/i, '').replace(/ - Topic/i, '').trim();
      let cleanTitle = track.title.replace(/\([^)]+\)/g, '').replace(/\[[^\]]+\]/g, '').trim();
      
      // If title contains '-', try to extract the real title
      if (cleanTitle.includes('-')) {
         cleanTitle = cleanTitle.split('-')[1].trim();
      }
      
      try {
        setIsLyricsLoading(true);
        setLyricsError(null);
        
        const searchQuery = `${cleanArtist} ${cleanTitle}`.trim();
        const res = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(searchQuery)}`);
        
        if (!res.ok) {
          throw new Error('Lyrics not found');
        }
        
        const data = await res.json();
        
        if (!data || data.length === 0) {
          throw new Error('No lyrics available');
        }
        
        if (data[0].syncedLyrics) {
          setSyncedLyrics(parseSyncedLyrics(data[0].syncedLyrics));
          setLyrics(null);
        } else if (data[0].plainLyrics) {
          setLyrics(data[0].plainLyrics);
          setSyncedLyrics(null);
        } else {
          throw new Error('No lyrics available');
        }
      } catch (err) {
        setLyricsError("Couldn't find lyrics for this song.");
        setLyrics(null);
        setSyncedLyrics(null);
      } finally {
        setIsLyricsLoading(false);
      }
    };

    fetchLyrics();
  }, [showLyrics, currentTrackIndex, playlist]);

  // Settings state
  const [showSettings, setShowSettings] = useState(false);
  const [tempPlaylistId, setTempPlaylistId] = useState('');
  const [activePlaylistId, setActivePlaylistId] = useState<string | null>(null);

  useEffect(() => {
    if (!activePlaylistId && process.env.NEXT_PUBLIC_YOUTUBE_PLAYLIST_ID) {
      setActivePlaylistId(process.env.NEXT_PUBLIC_YOUTUBE_PLAYLIST_ID);
      setTempPlaylistId(process.env.NEXT_PUBLIC_YOUTUBE_PLAYLIST_ID);
    }
  }, []);

  // Fetch playlist on activePlaylistId change
  useEffect(() => {
    const fetchPlaylist = async () => {
      if (!activePlaylistId) {
        if (!process.env.NEXT_PUBLIC_YOUTUBE_PLAYLIST_ID) {
          setError('Please set NEXT_PUBLIC_YOUTUBE_PLAYLIST_ID in .env.local or add one in settings');
          setIsLoading(false);
        }
        return;
      }
      try {
        setIsLoading(true);
        setError(null);
        playerRef.current = null; // Clear the player ref so we wait for the new player to be ready
        
        const res = await fetch(`/api/youtube/playlist?id=${activePlaylistId}`);
        const data = await res.json();
        
        if (data.error) throw new Error(data.error);
        if (data.tracks && data.tracks.length > 0) {
          const cleanedTracks = data.tracks.map((track: Track) => ({
            ...track,
            artist: track.artist.replace(/ - Topic/i, '').replace(/VEVO/i, '').trim()
          }));
          setPlaylist(cleanedTracks);
          const randomIndex = Math.floor(Math.random() * cleanedTracks.length);
          setCurrentTrackIndex(randomIndex);
          setProgress(0);
        } else {
          setError('Playlist is empty or invalid.');
        }
      } catch (err: any) {
        setError(err.message || 'Failed to fetch playlist');
      } finally {
        setIsLoading(false);
      }
    };

    fetchPlaylist();
  }, [activePlaylistId]);

  // When track changes, update the youtube video ID directly
  useEffect(() => {
    if (playlist.length === 0) return;
    const track = playlist[currentTrackIndex];
    setProgress(0);
    
    if (playerRef.current) {
      try {
        if (isPlaying) {
          playerRef.current.loadVideoById(track.id);
        } else {
          playerRef.current.cueVideoById(track.id);
        }
      } catch (e) {
        console.warn('Player not ready', e);
      }
    }
  }, [currentTrackIndex, playlist]);

  // Sync synced lyrics
  useEffect(() => {
    if (syncedLyrics) {
      let newIndex = -1;
      for (let i = 0; i < syncedLyrics.length; i++) {
        // buffer of 0.3s for visual snappiness
        if (syncedLyrics[i].time <= progress + 0.3) {
          newIndex = i;
        } else {
          break;
        }
      }
      
      if (newIndex !== activeLineIndex) {
        setActiveLineIndex(newIndex);
        
        if (lyricsContainerRef.current && newIndex !== -1) {
          const container = lyricsContainerRef.current;
          const activeElement = container.querySelector(`[data-index="${newIndex}"]`) as HTMLElement;
          if (activeElement) {
            container.scrollTo({
              top: activeElement.offsetTop - container.clientHeight / 2 + activeElement.clientHeight / 2,
              behavior: 'smooth'
            });
          }
        }
      }
    }
  }, [progress, syncedLyrics, activeLineIndex]);

  // Sync progress
  useEffect(() => {
    if (isPlaying) {
      progressIntervalRef.current = setInterval(() => {
        if (playerRef.current) {
          try {
            const time = playerRef.current.getCurrentTime();
            setProgress(time);
          } catch (e) {
            // Ignore if player not ready
          }
        }
      }, 1000);
    } else {
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    }

    return () => {
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    };
  }, [isPlaying]);

  const onPlayerReady = (event: YouTubeEvent) => {
    playerRef.current = event.target;
    // Load the current track since we don't rely on the videoId prop to change tracks
    if (playlist.length > 0) {
      const track = playlist[currentTrackIndex];
      try {
        if (isPlaying) {
          event.target.loadVideoById(track.id);
        } else {
          event.target.cueVideoById(track.id);
        }
      } catch (e) {
        console.warn('Player not ready', e);
      }
    }
    
    try {
      const dur = event.target.getDuration();
      if (dur > 0) setDuration(dur);
    } catch (e) {
      // Ignore
    }
  };

  const onPlayerStateChange = (event: YouTubeEvent) => {
    if (event.data === 1) { // Playing
      setIsPlaying(true);
      const dur = event.target.getDuration();
      if (dur > 0) setDuration(dur);
    }
    else if (event.data === 2) { // Paused
      setIsPlaying(false);
    }
    else if (event.data === 0) { // Ended
      if (stateRef.current.repeatMode === 2) {
        event.target.seekTo(0, true);
        event.target.playVideo();
      } else {
        handleNext(true);
      }
    }
    // We removed the 'cued' state check because we now use loadVideoById for playing
  };

  const togglePlay = () => {
    if (!playerRef.current) return;
    
    if (isPlaying) {
      playerRef.current.pauseVideo();
    } else {
      playerRef.current.playVideo();
    }
    setIsPlaying(!isPlaying);
  };

  const handleNext = (isAutomatic = false) => {
    const { isShuffle, repeatMode, currentTrackIndex: currentIndex, playlist: currentPlaylist } = stateRef.current;
    
    if (isAutomatic && repeatMode === 0 && !isShuffle && currentIndex === currentPlaylist.length - 1) {
      setIsPlaying(false);
      if (playerRef.current) {
        playerRef.current.seekTo(0, true);
        playerRef.current.pauseVideo();
      }
      return;
    }

    if (isShuffle && currentPlaylist.length > 1) {
      let nextIndex = currentIndex;
      while (nextIndex === currentIndex) {
        nextIndex = Math.floor(Math.random() * currentPlaylist.length);
      }
      setCurrentTrackIndex(nextIndex);
    } else {
      setCurrentTrackIndex((currentIndex + 1) % currentPlaylist.length);
    }
    setIsPlaying(true); // Auto-play when changing tracks manually
  };

  const handlePrev = () => {
    setCurrentTrackIndex((prev) => (prev - 1 + playlist.length) % playlist.length);
    setIsPlaying(true); // Auto-play when changing tracks manually
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!playerRef.current || duration === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    const newTime = pos * duration;
    playerRef.current.seekTo(newTime, true);
    setProgress(newTime);
  };

  const formatTime = (seconds: number) => {
    if (!seconds || isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const currentTrack = playlist[currentTrackIndex];
  const progressPercent = duration > 0 ? (progress / duration) * 100 : 0;

  const titleText = currentTrack ? currentTrack.title : (isLoading ? 'Loading...' : 'Local Train');
  const artistText = currentTrack ? currentTrack.artist : (isLoading ? 'Please wait' : 'All Aboard');
  const isLongTitle = titleText.length > 30;

  return (
    <main>
      <img src="/background.jpg" alt="Background" className="absolute top-0 left-0 w-full h-full object-cover z-0 brightness-90" />
      
      <nav className="absolute top-0 left-0 right-0 flex flex-col pt-4 pb-2 px-4 md:px-8 z-10 gap-4 md:gap-0">
        <div className="flex justify-between items-start w-full z-20">
          <div className="flex justify-start items-center gap-2 md:gap-3">
            <div className="text-xs md:text-sm font-bold text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] bg-black/20 px-3 py-1.5 md:px-4 rounded-full backdrop-blur-md whitespace-nowrap">
              {time || '1:15 pm'}
            </div>
            <div className="flex items-center gap-1.5 md:gap-2 bg-black/30 px-3 py-1.5 md:px-4 rounded-full text-xs md:text-sm font-medium text-white backdrop-blur-md border border-white/5 whitespace-nowrap">
              <div className="w-1.5 h-1.5 md:w-2 md:h-2 bg-[#00ff88] rounded-full shadow-[0_0_8px_#00ff88]"></div>
              <span className="whitespace-nowrap">38 online</span>
            </div>
          </div>
          
          <div className="flex justify-end gap-2 md:gap-4 items-center">
            <button 
              className={`flex items-center justify-center bg-white/5 border border-white/10 w-[34px] h-[34px] md:w-[38px] md:h-[38px] rounded-full text-white backdrop-blur-md cursor-pointer transition-colors hover:bg-white/10 ${showSearch ? 'bg-white/20 text-[#00ff88]' : ''}`}
              title="Search" 
              onClick={() => {
                setShowSearch(!showSearch);
                if (!showSearch) {
                  setShowLyrics(false);
                  setShowSettings(false);
                }
              }} 
              disabled={playlist.length === 0}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
              </svg>
            </button>

            <div className="relative" ref={ytMenuRef}>
              <button 
                className="flex items-center gap-2 bg-white/5 border border-white/10 px-3 py-1.5 md:px-4 md:py-2 rounded-full text-xs md:text-sm font-semibold text-white backdrop-blur-md cursor-pointer transition-colors hover:bg-white/10 whitespace-nowrap" 
                onClick={() => setShowYtMenu(!showYtMenu)}
              >
                 <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/>
                 </svg>
                 <span className="whitespace-nowrap">YT Music</span>
              </button>

              {showYtMenu && (
                <div className="absolute right-0 mt-2 w-40 bg-black/60 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden shadow-2xl z-50">
                  <button
                    className="w-full text-left px-4 py-3 text-sm text-white hover:bg-white/10 transition-colors border-b border-white/5 whitespace-nowrap"
                    onClick={() => {
                      setShowYtMenu(false);
                      if (currentTrack) window.open(`https://youtube.com/watch?v=${currentTrack.id}`, '_blank');
                    }}
                  >
                    View this Song
                  </button>
                  <button
                    className="w-full text-left px-4 py-3 text-sm text-white hover:bg-white/10 transition-colors border-b border-white/5 whitespace-nowrap"
                    onClick={() => {
                      setShowYtMenu(false);
                      const playlistId = activePlaylistId || process.env.NEXT_PUBLIC_YOUTUBE_PLAYLIST_ID;
                      if (playlistId) window.open(`https://youtube.com/playlist?list=${playlistId}`, '_blank');
                    }}
                  >
                    Open playlist
                  </button>
                  <button
                    className="w-full text-left px-4 py-3 text-sm text-white hover:bg-white/10 transition-colors whitespace-nowrap"
                    onClick={() => {
                      setShowYtMenu(false);
                      setShowSettings(true);
                      if (showLyrics) setShowLyrics(false);
                      if (showSearch) setShowSearch(false);
                    }}
                  >
                    Change Playlist
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-center z-10 md:absolute md:top-4 md:left-1/2 md:-translate-x-1/2 md:pointer-events-none w-full">
           <h1 className={`${sekuya.className} text-4xl md:text-5xl text-white tracking-widest select-none drop-shadow-[0_4px_10px_rgba(0,0,0,0.8)] text-center leading-none opacity-90 md:opacity-100`}>
            LOCAL<br />TRAIN
          </h1>
        </div>
      </nav>

      {/* Hidden YouTube Player */}
      <div style={{ display: 'none' }}>
        {playlist.length > 0 && activePlaylistId && (
          <YouTube 
            key={activePlaylistId}
            videoId={playlist[0].id} 
            onReady={onPlayerReady} 
            onStateChange={onPlayerStateChange} 
            opts={{ playerVars: { autoplay: 0, controls: 0 } }} 
          />
        )}
      </div>

      {/* Lyrics Overlay */}
      {showLyrics && (
        <div className="absolute top-5 bottom-[150px] left-1/2 -translate-x-1/2 w-[90%] max-w-[700px] z-20 flex flex-col items-center justify-start overflow-hidden bg-black/60 backdrop-blur-xl border border-white/10 rounded-3xl p-8 shadow-2xl">
           <h3 className="text-2xl font-bold text-white mb-6 text-center drop-shadow-md">
             {currentTrack ? currentTrack.title : 'Lyrics'}
           </h3>
           <div ref={lyricsContainerRef} className="w-full max-w-3xl overflow-y-auto overflow-x-hidden text-center flex-1 pr-4 relative" style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.2) transparent' }}>
             {isLyricsLoading ? (
               <div className="text-white/70 animate-pulse mt-10">Loading lyrics...</div>
             ) : lyricsError ? (
               <div className="flex flex-col items-center justify-center mt-10 gap-4">
                 <div className="text-[#ff6b6b]">{lyricsError}</div>
                 {currentTrack && (
                   <a 
                     href={`https://www.google.com/search?q=${encodeURIComponent(currentTrack.artist.replace(/ - Topic/i, '') + ' ' + currentTrack.title + ' lyrics')}`}
                     target="_blank"
                     rel="noopener noreferrer"
                     className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-full text-sm font-medium transition-colors border border-white/20 flex items-center gap-2"
                   >
                     <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                       <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
                     </svg>
                     Search on Google
                   </a>
                 )}
               </div>
             ) : syncedLyrics ? (
               <div className="pb-[50vh] pt-[20vh] flex flex-col gap-6">
                 {syncedLyrics.map((line, index) => (
                   <div 
                     key={index} 
                     data-index={index}
                     className={`transition-all duration-700 ease-out text-2xl leading-relaxed whitespace-pre-wrap cursor-pointer hover:text-white/80 ${index === activeLineIndex ? 'text-white scale-110 drop-shadow-[0_0_12px_rgba(255,255,255,0.8)]' : 'text-white/40 blur-[0.5px] scale-100'}`}
                     onClick={() => {
                        if (playerRef.current) {
                           playerRef.current.seekTo(line.time, true);
                           setProgress(line.time);
                        }
                     }}
                   >
                     {line.text || ' '}
                   </div>
                 ))}
               </div>
             ) : lyrics ? (
               <div className="text-white/90 text-lg leading-loose whitespace-pre-wrap pb-10">
                 {lyrics}
               </div>
             ) : (
               <div className="text-white/50 mt-10">No lyrics available</div>
             )}
           </div>
           
           <button 
             className="absolute top-6 right-6 text-white/50 hover:text-white transition-colors cursor-pointer bg-transparent border-none p-2"
             onClick={() => setShowLyrics(false)}
             title="Close Lyrics"
           >
             <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
               <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
             </svg>
           </button>
        </div>
      )}

      {/* Settings Overlay */}
      {showSettings && (
        <div className="absolute top-5 bottom-[150px] left-1/2 -translate-x-1/2 w-[90%] max-w-[500px] h-fit z-20 flex flex-col items-center justify-start overflow-hidden bg-black/60 backdrop-blur-xl border border-white/10 rounded-3xl p-8 shadow-2xl">
           <h3 className="text-2xl font-bold text-white mb-6 text-center drop-shadow-md">
             Settings
           </h3>
           <div className="w-full flex flex-col gap-4">
             <div>
               <label className="text-sm text-white/70 mb-2 block">YouTube Playlist ID</label>
               <input
                 type="text"
                 placeholder="e.g. PL7EN7w5QYtXWgOoEa-5mWuT5I0YQcyyNb"
                 value={tempPlaylistId}
                 onChange={(e) => setTempPlaylistId(e.target.value)}
                 className="w-full bg-white/10 border border-white/20 rounded-xl py-3 px-4 text-white placeholder-white/50 focus:outline-none focus:border-[#00ff88] transition-colors"
               />
               <p className="text-xs text-white/50 mt-2">
                 You can find the playlist ID in the URL of a YouTube playlist (the part after <code>list=</code>).
               </p>
             </div>
             <button
               className="w-full bg-[#00ff88] text-black font-semibold rounded-xl py-3 mt-4 hover:bg-[#00cc6a] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
               disabled={!tempPlaylistId.trim() || extractPlaylistId(tempPlaylistId) === activePlaylistId}
               onClick={() => {
                 const extractedId = extractPlaylistId(tempPlaylistId);
                 if (extractedId) {
                   setActivePlaylistId(extractedId);
                   setTempPlaylistId(extractedId);
                   setShowSettings(false);
                   setIsPlaying(true); // Attempt to autoplay after loading new playlist
                 }
               }}
             >
               Load Playlist
             </button>
           </div>
           
           <button 
             className="absolute top-6 right-6 text-white/50 hover:text-white transition-colors cursor-pointer bg-transparent border-none p-2"
             onClick={() => setShowSettings(false)}
             title="Close Settings"
           >
             <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
               <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
             </svg>
           </button>
        </div>
      )}

      {/* Search Overlay */}
      {showSearch && (
        <div className="absolute top-5 bottom-[150px] left-1/2 -translate-x-1/2 w-[90%] max-w-[700px] z-20 flex flex-col items-center justify-start overflow-hidden bg-black/60 backdrop-blur-xl border border-white/10 rounded-3xl p-8 shadow-2xl">
           <h3 className="text-2xl font-bold text-white mb-6 text-center drop-shadow-md">
             Search
           </h3>
           <span className="absolute top-6 left-8 text-sm font-medium text-white/60 bg-white/10 px-3 py-1 rounded-full border border-white/10">
             {playlist.length} songs
           </span>
           <div className="w-full max-w-2xl mb-6 relative">
             <input
               type="text"
               placeholder="Search by song or artist..."
               value={searchQuery}
               onChange={(e) => setSearchQuery(e.target.value)}
               className="w-full bg-white/10 border border-white/20 rounded-full py-3 px-6 text-white placeholder-white/50 focus:outline-none focus:border-[#00ff88] transition-colors"
               autoFocus
             />
             {searchQuery && (
               <button
                 className="absolute right-4 top-1/2 -translate-y-1/2 text-white/50 hover:text-white"
                 onClick={() => setSearchQuery('')}
               >
                 <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                   <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                 </svg>
               </button>
             )}
           </div>
           
           <div className="w-full max-w-2xl overflow-y-auto flex-1 pr-2 space-y-2" style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.2) transparent' }}>
             {playlist.map((track, index) => {
               if (searchQuery && !track.title.toLowerCase().includes(searchQuery.toLowerCase()) && !track.artist.toLowerCase().includes(searchQuery.toLowerCase())) {
                 return null;
               }
               const isCurrent = index === currentTrackIndex;
               return (
                 <div
                   key={track.id}
                   className={`flex items-center gap-4 p-3 rounded-xl cursor-pointer transition-colors ${isCurrent ? 'bg-white/20' : 'hover:bg-white/10'}`}
                   onClick={() => {
                     setCurrentTrackIndex(index);
                     setShowSearch(false);
                     setIsPlaying(true);
                   }}
                 >
                   <img src={track.albumArt} alt={track.title} className="w-12 h-12 rounded-md object-cover" />
                   <div className="flex-col flex-1 min-w-0">
                     <div className={`truncate font-semibold ${isCurrent ? 'text-[#00ff88]' : 'text-white'}`}>{track.title}</div>
                     <div className="truncate text-sm text-white/60">{track.artist}</div>
                   </div>
                   {isCurrent && (
                     <div className="text-[#00ff88]">
                       <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                         <path d="M8 5v14l11-7z"/>
                       </svg>
                     </div>
                   )}
                 </div>
               );
             })}
           </div>

           <button 
             className="absolute top-6 right-6 text-white/50 hover:text-white transition-colors cursor-pointer bg-transparent border-none p-2"
             onClick={() => setShowSearch(false)}
             title="Close Search"
           >
             <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
               <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
             </svg>
           </button>
        </div>
      )}

      <div className="absolute bottom-4 md:bottom-8 left-1/2 -translate-x-1/2 w-[95%] sm:w-[90%] max-w-[700px] bg-gradient-to-br from-[#8c322840] to-[#50141440] backdrop-blur-xl border border-white/10 rounded-[32px] md:rounded-[40px] px-4 md:px-6 py-3 md:py-4 flex flex-col shadow-[0_16px_40px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.1)] z-30">
        
        <div className="flex items-center gap-3 md:gap-6 w-full">
          <div className={`relative w-[50px] h-[50px] md:w-[70px] md:h-[70px] rounded-full overflow-hidden shadow-[0_4px_15px_rgba(0,0,0,0.4)] shrink-0 ${(isPlaying && !isLoading) ? 'animate-spin-slow' : ''}`}>
            <img src={currentTrack ? currentTrack.albumArt : "/album.jpg"} alt="Album Art" className="w-full h-full object-cover" />
          </div>

          <div className="grow flex flex-col gap-0 md:gap-1 w-full min-w-0 justify-center">
            {/* Row 1: Progress + Playback Controls */}
            <div className="flex items-center justify-between gap-4 w-full">
              <div className="flex items-center gap-2 md:gap-4 text-[10px] md:text-xs text-white/80 w-full grow">
                <span>{formatTime(progress)}</span>
                <div className="grow h-1 bg-white/20 rounded-full cursor-pointer relative" onClick={handleSeek}>
                  <div className="h-full bg-white rounded-full shadow-[0_0_10px_rgba(255,255,255,0.5)]" style={{ width: `${progressPercent}%` }}></div>
                </div>
                <span>{formatTime(duration)}</span>
              </div>

              <div className="flex items-center gap-2 md:gap-4 shrink-0">
                <button 
                  className="bg-transparent border-none text-white cursor-pointer flex items-center justify-center p-0 opacity-80 transition-all hover:opacity-100 hover:scale-110 disabled:opacity-50 disabled:hover:scale-100" 
                  title="Previous" onClick={handlePrev} disabled={playlist.length === 0}
                >
                  <svg width="20" height="20" className="md:w-6 md:h-6" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/>
                  </svg>
                </button>
                
                <button 
                  className="w-9 h-9 md:w-11 md:h-11 rounded-full bg-white text-black shadow-[0_4px_10px_rgba(0,0,0,0.3)] flex items-center justify-center p-0 transition-all hover:scale-105 disabled:opacity-50 disabled:hover:scale-100" 
                  onClick={togglePlay} title={isPlaying ? "Pause" : "Play"} disabled={playlist.length === 0 || isLoading}
                >
                  {isPlaying ? (
                    <svg width="20" height="20" className="md:w-6 md:h-6" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                    </svg>
                  ) : (
                    <svg width="20" height="20" className="md:w-6 md:h-6" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: '2px' }}>
                      <path d="M8 5v14l11-7z"/>
                    </svg>
                  )}
                </button>

                <button 
                  className="bg-transparent border-none text-white cursor-pointer flex items-center justify-center p-0 opacity-80 transition-all hover:opacity-100 hover:scale-110 disabled:opacity-50 disabled:hover:scale-100" 
                  title="Next" onClick={() => handleNext()} disabled={playlist.length === 0}
                >
                  <svg width="20" height="20" className="md:w-6 md:h-6" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/>
                  </svg>
                </button>
              </div>
            </div>

            {/* Row 2: Title/Artist + Extra Controls */}
            <div className="flex items-center justify-between gap-4 w-full">
              {error ? (
                 <div className="flex flex-col min-w-0">
                   <h2 className="text-base md:text-lg font-bold m-0 drop-shadow-sm text-[#ff6b6b]">Setup Required</h2>
                   <p className="text-xs md:text-sm text-white/80 m-0">{error}</p>
                 </div>
              ) : (
                <div className="flex flex-col overflow-hidden w-full min-w-0">
                  <div className={`relative w-full overflow-hidden whitespace-nowrap ${isLongTitle ? '[mask-image:linear-gradient(to_right,transparent,black_10px,black_calc(100%_-_10px),transparent)] [-webkit-mask-image:linear-gradient(to_right,transparent,black_10px,black_calc(100%_-_10px),transparent)]' : ''}`}>
                    {isLongTitle ? (
                      <div className="animate-marquee hover:[animation-play-state:paused]">
                        <h2 className="text-base md:text-lg font-bold m-0 drop-shadow-sm inline-block mr-8">{titleText}</h2>
                        <h2 className="text-base md:text-lg font-bold m-0 drop-shadow-sm inline-block mr-8">{titleText}</h2>
                      </div>
                    ) : (
                      <h2 className="text-base md:text-lg font-bold m-0 drop-shadow-sm truncate">{titleText}</h2>
                    )}
                  </div>
                  <p className="text-xs md:text-sm text-white/80 m-0 truncate">{artistText}</p>
                </div>
              )}

              <div className="flex items-center gap-4 md:gap-6 shrink-0">
                <button 
                  className={`bg-transparent border-none cursor-pointer flex items-center justify-center p-0 transition-all hover:scale-110 disabled:opacity-50 disabled:hover:scale-100 ${isShuffle ? 'text-[#00ff88] opacity-100 drop-shadow-[0_0_8px_rgba(0,255,136,0.5)]' : 'text-white opacity-80 hover:opacity-100'}`}
                  title="Shuffle" onClick={() => setIsShuffle(!isShuffle)} disabled={playlist.length === 0}
                >
                  <svg width="16" height="16" className="md:w-[18px] md:h-[18px]" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/>
                  </svg>
                </button>

                <button 
                  className={`bg-transparent border-none cursor-pointer flex items-center justify-center p-0 transition-all hover:scale-110 disabled:opacity-50 disabled:hover:scale-100 ${repeatMode > 0 ? 'text-[#00ff88] opacity-100 drop-shadow-[0_0_8px_rgba(0,255,136,0.5)]' : 'text-white opacity-80 hover:opacity-100'}`}
                  title={repeatMode === 2 ? "Repeat One" : repeatMode === 1 ? "Repeat All" : "Repeat Off"} 
                  onClick={() => setRepeatMode((prev) => ((prev + 1) % 3) as 0 | 1 | 2)} 
                  disabled={playlist.length === 0}
                >
                  {repeatMode === 2 ? (
                    <svg width="16" height="16" className="md:w-[18px] md:h-[18px]" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z"/>
                    </svg>
                  ) : (
                    <svg width="16" height="16" className="md:w-[18px] md:h-[18px]" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/>
                    </svg>
                  )}
                </button>

                <button 
                  className={`bg-transparent border-none cursor-pointer flex items-center justify-center p-0 transition-all hover:scale-110 disabled:opacity-50 disabled:hover:scale-100 ${showLyrics ? 'text-[#00ff88] opacity-100 drop-shadow-[0_0_8px_rgba(0,255,136,0.5)]' : 'text-white opacity-80 hover:opacity-100'}`}
                  title="Lyrics" 
                  onClick={() => {
                    setShowLyrics(!showLyrics);
                    if (!showLyrics) {
                      setShowSearch(false);
                      setShowSettings(false);
                    }
                  }} 
                  disabled={playlist.length === 0}
                >
                  <svg width="16" height="16" className="md:w-[18px] md:h-[18px]" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M21 11.01L3 11v2h18zM3 16h12v2H3zM21 6H3v2.01L21 8z"/>
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>

      </div>
    </main>
  );
}
