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

  // Fetch playlist on mount
  useEffect(() => {
    const fetchPlaylist = async () => {
      try {
        setIsLoading(true);
        // Use environment variable if available, else a fallback ID
        const playlistId = process.env.NEXT_PUBLIC_YOUTUBE_PLAYLIST_ID;
        if (!playlistId) {
          setError('Please set NEXT_PUBLIC_YOUTUBE_PLAYLIST_ID in .env.local');
          setIsLoading(false);
          return;
        }

        const res = await fetch(`/api/youtube/playlist?id=${playlistId}`);
        const data = await res.json();
        
        if (data.error) throw new Error(data.error);
        if (data.tracks && data.tracks.length > 0) {
          setPlaylist(data.tracks);
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
  }, []);

  // When track changes, update the youtube video ID directly
  useEffect(() => {
    if (playlist.length === 0) return;
    const track = playlist[currentTrackIndex];
    setProgress(0);
    
    if (playerRef.current) {
      if (isPlaying) {
        playerRef.current.loadVideoById(track.id);
      } else {
        playerRef.current.cueVideoById(track.id);
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
          const time = playerRef.current.getCurrentTime();
          setProgress(time);
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
      if (isPlaying) {
        event.target.loadVideoById(track.id);
      } else {
        event.target.cueVideoById(track.id);
      }
    }
    
    const dur = event.target.getDuration();
    if (dur > 0) setDuration(dur);
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
      
      <nav className="absolute top-0 left-0 right-0 grid grid-cols-3 items-start pt-4 pb-2 px-8 z-10">
        <div className="flex justify-start items-center gap-3">
          <div className="text-sm font-bold text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] bg-black/20 px-4 py-1.5 rounded-full backdrop-blur-md">
            {time || '1:15 pm'}
          </div>
          <div className="flex items-center gap-2 bg-black/30 px-4 py-1.5 rounded-full text-sm font-medium text-white backdrop-blur-md border border-white/5">
            <div className="w-2 h-2 bg-[#00ff88] rounded-full shadow-[0_0_8px_#00ff88]"></div>
            <span className="hidden sm:inline">38 online</span>
          </div>
        </div>
        <div className="flex justify-center">
           <h1 className={`${sekuya.className} text-3xl sm:text-5xl text-white tracking-widest select-none drop-shadow-[0_4px_10px_rgba(0,0,0,0.8)] text-center leading-none`}>
          
            LOCAL TRAIN
          </h1>
        </div>
        <div className="flex justify-end gap-4">

          <div className="relative" ref={ytMenuRef}>
            <button 
              className="flex items-center gap-2 bg-white/5 border border-white/10 px-4 py-2 rounded-full text-sm font-semibold text-white backdrop-blur-md cursor-pointer transition-colors hover:bg-white/10" 
              onClick={() => setShowYtMenu(!showYtMenu)}
            >
               <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/>
               </svg>
               YT Music
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
                  className="w-full text-left px-4 py-3 text-sm text-white hover:bg-white/10 transition-colors whitespace-nowrap"
                  onClick={() => {
                    setShowYtMenu(false);
                    const playlistId = process.env.NEXT_PUBLIC_YOUTUBE_PLAYLIST_ID;
                    if (playlistId) window.open(`https://youtube.com/playlist?list=${playlistId}`, '_blank');
                  }}
                >
                  Open playlist
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* Hidden YouTube Player */}
      <div style={{ display: 'none' }}>
        {playlist.length > 0 && (
          <YouTube 
            videoId={playlist[0].id} 
            onReady={onPlayerReady} 
            onStateChange={onPlayerStateChange} 
            opts={{ playerVars: { autoplay: 0, controls: 0 } }} 
          />
        )}
      </div>

      {/* Lyrics Overlay */}
      {showLyrics && (
        <div className="absolute top-16 bottom-[130px] left-1/2 -translate-x-1/2 w-[90%] max-w-[1000px] z-20 flex flex-col items-center justify-start overflow-hidden bg-black/60 backdrop-blur-xl border border-white/10 rounded-3xl p-8 max-sm:bottom-28 shadow-2xl">
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

      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 w-[90%] max-w-[700px] bg-gradient-to-br from-[#8c322840] to-[#50141440] backdrop-blur-xl border border-white/10 rounded-[40px] px-6 py-4 flex items-center gap-6 shadow-[0_16px_40px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.1)] z-30 max-sm:flex-col max-sm:p-6 max-sm:gap-4 max-sm:rounded-3xl max-sm:bottom-4">
        
        <div className={`relative w-[70px] h-[70px] rounded-full overflow-hidden shadow-[0_4px_15px_rgba(0,0,0,0.4)] shrink-0 max-sm:w-[100px] max-sm:h-[100px] ${(isPlaying && !isLoading) ? 'animate-spin-slow' : ''}`}>
          <img src={currentTrack ? currentTrack.albumArt : "/album.jpg"} alt="Album Art" className="w-full h-full object-cover" />
        </div>

        <div className="grow flex flex-col gap-2 w-full min-w-0">
          {error ? (
             <div className="flex flex-col">
               <h2 className="text-lg font-bold m-0 drop-shadow-sm text-[#ff6b6b]">Setup Required</h2>
               <p className="text-sm text-white/80 m-0">{error}</p>
             </div>
          ) : (
            <div className="flex flex-col overflow-hidden w-full">
              <div className={`relative w-full overflow-hidden whitespace-nowrap ${isLongTitle ? '[mask-image:linear-gradient(to_right,transparent,black_10px,black_calc(100%_-_10px),transparent)] [-webkit-mask-image:linear-gradient(to_right,transparent,black_10px,black_calc(100%_-_10px),transparent)]' : ''}`}>
                {isLongTitle ? (
                  <div className="animate-marquee hover:[animation-play-state:paused]">
                    <h2 className="text-lg font-bold m-0 drop-shadow-sm inline-block mr-8">{titleText}</h2>
                    <h2 className="text-lg font-bold m-0 drop-shadow-sm inline-block mr-8">{titleText}</h2>
                  </div>
                ) : (
                  <h2 className="text-lg font-bold m-0 drop-shadow-sm truncate">{titleText}</h2>
                )}
              </div>
              <p className="text-sm text-white/80 m-0 truncate">{artistText}</p>
            </div>
          )}

          <div className="flex items-center gap-4 text-xs text-white/80 w-full">
            <span>{formatTime(progress)}</span>
            <div className="grow h-1 bg-white/20 rounded-full cursor-pointer relative" onClick={handleSeek}>
              <div className="h-full bg-white rounded-full shadow-[0_0_10px_rgba(255,255,255,0.5)]" style={{ width: `${progressPercent}%` }}></div>
            </div>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        <div className="flex items-center gap-4 shrink-0 max-sm:mt-2">
          <button 
            className={`bg-transparent border-none cursor-pointer flex items-center justify-center p-0 transition-all hover:scale-110 disabled:opacity-50 disabled:hover:scale-100 ${isShuffle ? 'text-[#00ff88] opacity-100 drop-shadow-[0_0_8px_rgba(0,255,136,0.5)]' : 'text-white opacity-80 hover:opacity-100'}`}
            title="Shuffle" onClick={() => setIsShuffle(!isShuffle)} disabled={playlist.length === 0}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/>
            </svg>
          </button>

          <button 
            className="bg-transparent border-none text-white cursor-pointer flex items-center justify-center p-0 opacity-80 transition-all hover:opacity-100 hover:scale-110 disabled:opacity-50 disabled:hover:scale-100" 
            title="Previous" onClick={handlePrev} disabled={playlist.length === 0}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/>
            </svg>
          </button>
          
          <button 
            className="w-11 h-11 rounded-full bg-white text-black shadow-[0_4px_10px_rgba(0,0,0,0.3)] flex items-center justify-center p-0 transition-all hover:scale-105 disabled:opacity-50 disabled:hover:scale-100" 
            onClick={togglePlay} title={isPlaying ? "Pause" : "Play"} disabled={playlist.length === 0 || isLoading}
          >
            {isPlaying ? (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
              </svg>
            ) : (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: '4px' }}>
                <path d="M8 5v14l11-7z"/>
              </svg>
            )}
          </button>

          <button 
            className="bg-transparent border-none text-white cursor-pointer flex items-center justify-center p-0 opacity-80 transition-all hover:opacity-100 hover:scale-110 disabled:opacity-50 disabled:hover:scale-100" 
            title="Next" onClick={() => handleNext()} disabled={playlist.length === 0}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/>
            </svg>
          </button>

          <button 
            className={`bg-transparent border-none cursor-pointer flex items-center justify-center p-0 transition-all hover:scale-110 disabled:opacity-50 disabled:hover:scale-100 ${repeatMode > 0 ? 'text-[#00ff88] opacity-100 drop-shadow-[0_0_8px_rgba(0,255,136,0.5)]' : 'text-white opacity-80 hover:opacity-100'}`}
            title={repeatMode === 2 ? "Repeat One" : repeatMode === 1 ? "Repeat All" : "Repeat Off"} 
            onClick={() => setRepeatMode((prev) => ((prev + 1) % 3) as 0 | 1 | 2)} 
            disabled={playlist.length === 0}
          >
            {repeatMode === 2 ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z"/>
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/>
              </svg>
            )}
          </button>

          <button 
            className={`bg-transparent border-none cursor-pointer flex items-center justify-center p-0 transition-all hover:scale-110 disabled:opacity-50 disabled:hover:scale-100 ${showLyrics ? 'text-[#00ff88] opacity-100 drop-shadow-[0_0_8px_rgba(0,255,136,0.5)]' : 'text-white opacity-80 hover:opacity-100'}`}
            title="Lyrics" 
            onClick={() => setShowLyrics(!showLyrics)} 
            disabled={playlist.length === 0}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M21 11.01L3 11v2h18zM3 16h12v2H3zM21 6H3v2.01L21 8z"/>
            </svg>
          </button>
        </div>
      </div>
    </main>
  );
}
