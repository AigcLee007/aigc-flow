/**
 * TapNow-style minimal canvas chrome.
 */
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bell, CheckCheck, Megaphone, Sparkles, X } from 'lucide-react';
import { useFlowCanvasStore } from '../store/flowCanvasStore';
import { AUTH_SESSION_CHANGE_EVENT, getStoredAuthSessionToken } from '../../services/accountIdentity';
import { fetchBillingAccount } from '../../services/accountService';
import { formatPoint } from '../../utils/pointFormat';

const LogoMark: React.FC = () => <img src="/logo.png" alt="艾特智绘" style={logoImageStyle} />;
const formatToolbarPoint = (value: number) => formatPoint(value).replace(/\.0$/, '');
const SEEN_STORAGE_KEY = 'seen_announcement_ids';

interface Announcement {
  id: string;
  title: string;
  content: string;
  active: boolean;
  date: string;
  pinned?: boolean;
  images?: string[];
}

const readSeenAnnouncementIds = (): string[] => {
  try {
    const raw = window.localStorage.getItem(SEEN_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => String(item));
  } catch {
    return [];
  }
};

const writeSeenAnnouncementIds = (ids: string[]) => {
  try {
    window.localStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify(Array.from(new Set(ids))));
  } catch {}
};

const formatAnnouncementDate = (input?: string) => {
  if (!input) return '';
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString();
};

export const FlowTopToolbar: React.FC<{
  onToggleCulling: () => void;
  cullingEnabled: boolean;
}> = memo(function FlowTopToolbar() {
  const projectTitle = useFlowCanvasStore((s) => s.projectTitle);
  const setProjectTitle = useFlowCanvasStore((s) => s.setProjectTitle);
  const [points, setPoints] = useState(0);
  const [pointsLoading, setPointsLoading] = useState(false);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [seenIds, setSeenIds] = useState<string[]>(() => readSeenAnnouncementIds());
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<Announcement | null>(null);
  const notificationRef = useRef<HTMLDivElement | null>(null);

  const refreshPoints = useCallback(async () => {
    if (!getStoredAuthSessionToken()) {
      setPoints(0);
      setPointsLoading(false);
      return;
    }

    setPointsLoading(true);
    try {
      const data = await fetchBillingAccount({ ledgerPageSize: 1 });
      setPoints(data?.account?.points ?? 0);
    } catch {
      setPoints(0);
    } finally {
      setPointsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshPoints();

    if (typeof window === 'undefined') return;
    window.addEventListener(AUTH_SESSION_CHANGE_EVENT, refreshPoints);
    window.addEventListener('storage', refreshPoints);
    return () => {
      window.removeEventListener(AUTH_SESSION_CHANGE_EVENT, refreshPoints);
      window.removeEventListener('storage', refreshPoints);
    };
  }, [refreshPoints]);

  const refreshAnnouncements = useCallback(async () => {
    try {
      const response = await fetch('/api/announcements?page=1&pageSize=50');
      if (!response.ok) {
        setAnnouncements([]);
        return;
      }
      const data = await response.json().catch(() => ({}));
      const list: Announcement[] = Array.isArray(data?.items) ? data.items : [];
      setAnnouncements(list.filter((item) => item?.active && item?.content));
    } catch {
      setAnnouncements([]);
    }
  }, []);

  useEffect(() => {
    void refreshAnnouncements();
  }, [refreshAnnouncements]);

  useEffect(() => {
    if (!notificationOpen) return;
    const handleMouseDown = (event: MouseEvent) => {
      if (notificationRef.current && !notificationRef.current.contains(event.target as Node)) {
        setNotificationOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setNotificationOpen(false);
        setSelectedAnnouncement(null);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [notificationOpen]);

  const unreadIds = useMemo(
    () => announcements.filter((item) => !seenIds.includes(item.id)).map((item) => item.id),
    [announcements, seenIds],
  );

  const markAnnouncementsRead = useCallback(
    (ids: string[]) => {
      if (!ids.length) return;
      const next = Array.from(new Set([...seenIds, ...ids.map((id) => String(id))]));
      setSeenIds(next);
      writeSeenAnnouncementIds(next);
    },
    [seenIds],
  );

  const openAnnouncement = (announcement: Announcement) => {
    setSelectedAnnouncement(announcement);
    markAnnouncementsRead([announcement.id]);
  };

  const markAllRead = () => {
    markAnnouncementsRead(announcements.map((item) => item.id));
  };

  return (
    <div className="nodrag nopan nowheel" style={topChromeStyle}>
      <div style={titleClusterStyle}>
        <LogoMark />
        <input
          value={projectTitle || '未命名项目'}
          onChange={(event) => setProjectTitle(event.target.value)}
          style={titleInputStyle}
          spellCheck={false}
          aria-label="项目名称"
        />
      </div>

      <div style={rightClusterStyle}>
        <button type="button" style={topPillStyle} title="当前金币">
          <Sparkles size={23} />
          <span>{pointsLoading ? '...' : formatToolbarPoint(points)}</span>
        </button>
        <div ref={notificationRef} style={notificationHostStyle}>
          <button
            type="button"
            style={topPillStyle}
            title="通知"
            onClick={() => {
              setNotificationOpen((open) => !open);
              void refreshAnnouncements();
            }}
          >
            <Bell size={22} />
            <span>通知</span>
            {unreadIds.length > 0 && (
              <span style={notificationBadgeStyle}>
                {unreadIds.length > 99 ? '99+' : unreadIds.length}
              </span>
            )}
          </button>
          {notificationOpen && (
            <div style={notificationPanelStyle}>
              <div style={notificationHeaderStyle}>
                <div style={notificationHeaderTitleStyle}>
                  <Megaphone size={17} color="#93c5fd" />
                  <span>通知</span>
                </div>
                <button
                  type="button"
                  style={markReadButtonStyle}
                  onClick={markAllRead}
                  disabled={announcements.length === 0}
                >
                  <CheckCheck size={13} />
                  全部已读
                </button>
              </div>

              <div style={notificationListStyle}>
                {announcements.length === 0 ? (
                  <div style={emptyNotificationStyle}>暂无公告</div>
                ) : (
                  announcements.map((item) => {
                    const unread = !seenIds.includes(item.id);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        style={notificationItemStyle}
                        onClick={() => openAnnouncement(item)}
                      >
                        <span style={notificationItemContentStyle}>
                          <span style={notificationItemTitleStyle}>{item.title || '系统公告'}</span>
                          {item.pinned && <span style={pinnedStyle}>置顶</span>}
                          <span style={notificationItemTextStyle}>{item.content}</span>
                          <span style={notificationDateStyle}>{formatAnnouncementDate(item.date)}</span>
                        </span>
                        {unread && <span style={unreadDotStyle} />}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {selectedAnnouncement && (
        <div style={announcementOverlayStyle} onMouseDown={() => setSelectedAnnouncement(null)}>
          <div style={announcementModalStyle} onMouseDown={(event) => event.stopPropagation()}>
            <div style={announcementModalHeaderStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                <span style={announcementIconStyle}>
                  <Megaphone size={20} />
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={announcementTitleStyle}>{selectedAnnouncement.title || '系统公告'}</div>
                  <div style={announcementDateModalStyle}>{formatAnnouncementDate(selectedAnnouncement.date)}</div>
                </div>
              </div>
              <button type="button" style={modalCloseButtonStyle} onClick={() => setSelectedAnnouncement(null)}>
                <X size={18} />
              </button>
            </div>
            <div style={announcementBodyStyle}>{selectedAnnouncement.content}</div>
            {!!selectedAnnouncement.images?.length && (
              <div style={announcementImagesStyle}>
                {selectedAnnouncement.images.map((src, index) => (
                  <img key={`${src}-${index}`} src={src} alt={`announcement-${index + 1}`} style={announcementImageStyle} />
                ))}
              </div>
            )}
            <div style={announcementFooterStyle}>
              <button type="button" style={confirmButtonStyle} onClick={() => setSelectedAnnouncement(null)}>
                我知道了
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

const topChromeStyle: React.CSSProperties = {
  position: 'fixed',
  left: 29,
  right: 29,
  top: 8,
  zIndex: 900,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  pointerEvents: 'none',
};

const titleClusterStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 22,
  pointerEvents: 'auto',
};

const logoImageStyle: React.CSSProperties = {
  width: 100,
  height: 100,
  objectFit: 'contain',
  display: 'block',
  filter: 'drop-shadow(0 8px 14px rgba(0,0,0,0.34))',
};

const titleInputStyle: React.CSSProperties = {
  width: 240,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  color: '#fff',
  fontSize: 27,
  fontWeight: 800,
  lineHeight: 1,
  padding: 0,
  textShadow: '0 2px 12px rgba(0,0,0,0.35)',
};

const rightClusterStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  pointerEvents: 'auto',
};

const topPillStyle: React.CSSProperties = {
  height: 60,
  border: 'none',
  borderRadius: 18,
  padding: '0 22px',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  background: 'rgba(43,43,49,0.96)',
  color: '#fff',
  fontSize: 20,
  fontWeight: 820,
  cursor: 'pointer',
  boxShadow: '0 12px 34px rgba(0,0,0,0.34), inset 0 1px 0 rgba(255,255,255,0.06)',
};

const notificationHostStyle: React.CSSProperties = {
  position: 'relative',
};

const notificationBadgeStyle: React.CSSProperties = {
  minWidth: 20,
  height: 20,
  borderRadius: 999,
  padding: '0 6px',
  display: 'grid',
  placeItems: 'center',
  background: '#ef4444',
  color: '#fff',
  fontSize: 11,
  fontWeight: 850,
  lineHeight: 1,
  boxShadow: '0 0 0 2px rgba(43,43,49,0.96), 0 0 14px rgba(239,68,68,0.78)',
};

const notificationPanelStyle: React.CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 14px)',
  right: 0,
  width: 370,
  maxWidth: 'calc(100vw - 48px)',
  overflow: 'hidden',
  borderRadius: 18,
  background: 'rgba(18,20,27,0.98)',
  border: '1px solid rgba(255,255,255,0.12)',
  boxShadow: '0 28px 70px rgba(0,0,0,0.56)',
  backdropFilter: 'blur(22px)',
};

const notificationHeaderStyle: React.CSSProperties = {
  height: 54,
  padding: '0 14px 0 16px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  borderBottom: '1px solid rgba(255,255,255,0.08)',
};

const notificationHeaderTitleStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 9,
  color: '#fff',
  fontSize: 15,
  fontWeight: 780,
};

const markReadButtonStyle: React.CSSProperties = {
  height: 32,
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 10,
  background: 'rgba(255,255,255,0.055)',
  color: '#d1d5db',
  padding: '0 10px',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
  fontWeight: 700,
  cursor: 'pointer',
};

const notificationListStyle: React.CSSProperties = {
  maxHeight: '62vh',
  overflowY: 'auto',
};

const emptyNotificationStyle: React.CSSProperties = {
  padding: '44px 16px',
  textAlign: 'center',
  color: 'rgba(255,255,255,0.45)',
  fontSize: 14,
};

const notificationItemStyle: React.CSSProperties = {
  position: 'relative',
  width: '100%',
  border: 'none',
  borderBottom: '1px solid rgba(255,255,255,0.06)',
  background: 'transparent',
  color: '#fff',
  padding: '14px 18px',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  textAlign: 'left',
  cursor: 'pointer',
};

const notificationItemContentStyle: React.CSSProperties = {
  minWidth: 0,
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const notificationItemTitleStyle: React.CSSProperties = {
  color: '#f8fafc',
  fontSize: 14,
  fontWeight: 800,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const pinnedStyle: React.CSSProperties = {
  alignSelf: 'flex-start',
  borderRadius: 999,
  background: 'rgba(245,158,11,0.16)',
  color: '#fbbf24',
  padding: '2px 7px',
  fontSize: 10,
  fontWeight: 750,
};

const notificationItemTextStyle: React.CSSProperties = {
  color: 'rgba(209,213,219,0.78)',
  fontSize: 12,
  lineHeight: 1.55,
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
};

const notificationDateStyle: React.CSSProperties = {
  color: 'rgba(148,163,184,0.62)',
  fontSize: 11,
};

const unreadDotStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: '50%',
  background: '#60a5fa',
  boxShadow: '0 0 10px rgba(96,165,250,0.85)',
  flexShrink: 0,
};

const announcementOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 1300,
  background: 'rgba(0,0,0,0.62)',
  backdropFilter: 'blur(6px)',
  display: 'grid',
  placeItems: 'center',
  pointerEvents: 'auto',
  padding: 24,
};

const announcementModalStyle: React.CSSProperties = {
  width: 'min(520px, calc(100vw - 32px))',
  maxHeight: '86vh',
  overflow: 'hidden',
  borderRadius: 22,
  background: 'rgba(24,24,27,0.98)',
  border: '1px solid rgba(245,158,11,0.22)',
  boxShadow: '0 32px 86px rgba(0,0,0,0.65)',
};

const announcementModalHeaderStyle: React.CSSProperties = {
  padding: '18px 18px 16px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  borderBottom: '1px solid rgba(255,255,255,0.07)',
  background: 'linear-gradient(90deg, rgba(245,158,11,0.12), transparent)',
};

const announcementIconStyle: React.CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: 12,
  display: 'grid',
  placeItems: 'center',
  background: 'rgba(245,158,11,0.12)',
  color: '#f59e0b',
  flexShrink: 0,
};

const announcementTitleStyle: React.CSSProperties = {
  color: '#fff',
  fontSize: 16,
  fontWeight: 820,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const announcementDateModalStyle: React.CSSProperties = {
  marginTop: 4,
  color: 'rgba(209,213,219,0.58)',
  fontSize: 12,
};

const modalCloseButtonStyle: React.CSSProperties = {
  width: 32,
  height: 32,
  border: 'none',
  borderRadius: 10,
  display: 'grid',
  placeItems: 'center',
  background: 'rgba(255,255,255,0.06)',
  color: 'rgba(255,255,255,0.72)',
  cursor: 'pointer',
  flexShrink: 0,
};

const announcementBodyStyle: React.CSSProperties = {
  maxHeight: '38vh',
  overflowY: 'auto',
  padding: '18px 20px',
  color: '#d4d4d8',
  fontSize: 14,
  lineHeight: 1.75,
  whiteSpace: 'pre-wrap',
};

const announcementImagesStyle: React.CSSProperties = {
  maxHeight: '26vh',
  overflowY: 'auto',
  padding: '0 20px 18px',
  display: 'grid',
  gap: 10,
};

const announcementImageStyle: React.CSSProperties = {
  width: '100%',
  maxHeight: 240,
  objectFit: 'contain',
  borderRadius: 14,
  border: '1px solid rgba(255,255,255,0.1)',
  background: 'rgba(0,0,0,0.25)',
};

const announcementFooterStyle: React.CSSProperties = {
  padding: '14px 18px 18px',
  display: 'flex',
  justifyContent: 'flex-end',
  borderTop: '1px solid rgba(255,255,255,0.06)',
};

const confirmButtonStyle: React.CSSProperties = {
  height: 38,
  border: 'none',
  borderRadius: 12,
  background: '#f59e0b',
  color: '#111827',
  padding: '0 18px',
  fontSize: 14,
  fontWeight: 800,
  cursor: 'pointer',
};
