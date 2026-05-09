import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Bell,
  CheckCheck,
  CreditCard,
  LayoutDashboard,
  Loader2,
  LogOut,
  Megaphone,
  RefreshCw,
  ShieldCheck,
  UserRound,
  Wallet,
} from 'lucide-react';
import AuthPanel from './AuthPanel';
import BillingPanel from './BillingPanel';
import {
  AUTH_SESSION_CHANGE_EVENT,
  AuthSessionPayload,
  fetchCurrentAuthSession,
  logoutAuthSession,
} from '../src/services/accountIdentity';
import { BillingAccountPayload, fetchBillingAccount } from '../src/services/accountService';
import { formatPoint } from '../src/utils/pointFormat';

type AccountTab = 'profile' | 'security' | 'wallet' | 'notifications' | 'admin';

interface Announcement {
  id: string;
  title: string;
  content: string;
  active: boolean;
  date: string;
  pinned?: boolean;
  images?: string[];
}

const SEEN_STORAGE_KEY = 'seen_announcement_ids';

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

const parseTab = (): AccountTab => {
  if (typeof window === 'undefined') return 'profile';
  const value = new URLSearchParams(window.location.search).get('tab');
  if (value === 'security' || value === 'wallet' || value === 'notifications' || value === 'admin') {
    return value;
  }
  return 'profile';
};

const formatDateTime = (input?: string | null) => {
  if (!input) return '-';
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
};

const formatDate = (input?: string | null) => {
  if (!input) return '';
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString();
};

const roleLabel = (role?: string) => {
  if (role === 'super_admin') return '超级管理员';
  if (role === 'admin') return '管理员';
  return '普通用户';
};

const statusLabel = (status?: string) => (status === 'disabled' ? '已停用' : '正常');

const AccountCenterPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<AccountTab>(() => parseTab());
  const [session, setSession] = useState<AuthSessionPayload | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [billing, setBilling] = useState<BillingAccountPayload | null>(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [seenIds, setSeenIds] = useState<string[]>(() => readSeenAnnouncementIds());
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<Announcement | null>(null);

  const refreshSession = useCallback(async () => {
    setSessionLoading(true);
    try {
      const next = await fetchCurrentAuthSession();
      setSession(next);
    } catch {
      setSession(null);
    } finally {
      setSessionLoading(false);
    }
  }, []);

  const refreshBilling = useCallback(async () => {
    if (!session?.authenticated) {
      setBilling(null);
      return;
    }
    setBillingLoading(true);
    try {
      const next = await fetchBillingAccount({ ledgerPageSize: 5 });
      setBilling(next);
    } catch {
      setBilling(null);
    } finally {
      setBillingLoading(false);
    }
  }, [session?.authenticated]);

  const refreshAnnouncements = useCallback(async () => {
    try {
      const response = await fetch('/api/announcements?page=1&pageSize=50');
      if (!response.ok) {
        setAnnouncements([]);
        return;
      }
      const data = await response.json().catch(() => ({}));
      const items: Announcement[] = Array.isArray(data?.items) ? data.items : [];
      setAnnouncements(items.filter((item) => item.active && item.content));
    } catch {
      setAnnouncements([]);
    }
  }, []);

  useEffect(() => {
    void refreshSession();
    void refreshAnnouncements();
  }, [refreshAnnouncements, refreshSession]);

  useEffect(() => {
    const handleSessionChange = () => {
      void refreshSession();
    };
    window.addEventListener(AUTH_SESSION_CHANGE_EVENT, handleSessionChange);
    window.addEventListener('storage', handleSessionChange);
    return () => {
      window.removeEventListener(AUTH_SESSION_CHANGE_EVENT, handleSessionChange);
      window.removeEventListener('storage', handleSessionChange);
    };
  }, [refreshSession]);

  useEffect(() => {
    void refreshBilling();
  }, [refreshBilling]);

  const setTab = (tab: AccountTab) => {
    setActiveTab(tab);
    if (typeof window !== 'undefined') {
      const nextUrl = `/account?tab=${tab}`;
      window.history.replaceState(null, '', nextUrl);
    }
  };

  const markAnnouncementsRead = useCallback(
    (ids: string[]) => {
      if (!ids.length) return;
      const next = Array.from(new Set([...seenIds, ...ids]));
      setSeenIds(next);
      writeSeenAnnouncementIds(next);
    },
    [seenIds],
  );

  const unreadIds = useMemo(
    () => announcements.filter((item) => !seenIds.includes(item.id)).map((item) => item.id),
    [announcements, seenIds],
  );

  const tabs = useMemo(
    () =>
      [
        { id: 'profile' as const, label: '账号资料', icon: UserRound },
        { id: 'security' as const, label: '安全设置', icon: ShieldCheck },
        { id: 'wallet' as const, label: '金币账户', icon: Wallet },
        { id: 'notifications' as const, label: '通知公告', icon: Bell, badge: unreadIds.length },
        ...(session?.user?.isAdmin
          ? [{ id: 'admin' as const, label: '管理入口', icon: LayoutDashboard }]
          : []),
      ],
    [session?.user?.isAdmin, unreadIds.length],
  );

  const user = session?.user;
  const displayName = user?.displayName || user?.email || '未登录用户';

  return (
    <div className="min-h-screen overflow-y-auto bg-[#07070c] px-4 py-6 text-white">
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-4">
            <img src="/logo.png" alt="艾特智绘" className="h-14 w-14 shrink-0 object-contain" />
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-[0.22em] text-sky-300">Account Center</div>
              <h1 className="mt-1 truncate text-3xl font-semibold">账号中心</h1>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                window.location.href = '/create/flow';
              }}
              className="inline-flex h-11 items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 text-sm text-gray-100 hover:bg-white/10"
            >
              <ArrowLeft size={15} />
              返回画布
            </button>
            {session?.authenticated && (
              <button
                type="button"
                onClick={() => {
                  void logoutAuthSession().finally(() => {
                    window.location.href = '/';
                  });
                }}
                className="inline-flex h-11 items-center gap-2 rounded-2xl border border-red-400/20 bg-red-500/10 px-4 text-sm text-red-100 hover:bg-red-500/15"
              >
                <LogOut size={15} />
                退出登录
              </button>
            )}
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
          <aside className="space-y-4">
            <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.4)]">
              <div className="flex items-center gap-4">
                <div className="grid h-14 w-14 shrink-0 place-items-center rounded-full border border-white/15 bg-white/8 text-xl font-semibold">
                  {(displayName || 'U').charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-lg font-semibold">{sessionLoading ? '加载中' : displayName}</div>
                  <div className="mt-1 truncate text-xs text-gray-400">{user?.email || '登录后查看账号信息'}</div>
                </div>
              </div>
              {session?.authenticated && (
                <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-2xl border border-white/8 bg-black/20 p-3">
                    <div className="text-gray-500">身份</div>
                    <div className="mt-1 font-semibold text-gray-100">{roleLabel(user?.role)}</div>
                  </div>
                  <div className="rounded-2xl border border-white/8 bg-black/20 p-3">
                    <div className="text-gray-500">金币</div>
                    <div className="mt-1 font-semibold text-amber-200">{formatPoint(billing?.account.points || 0)}</div>
                  </div>
                </div>
              )}
            </div>

            <nav className="rounded-3xl border border-white/10 bg-white/[0.04] p-2">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const active = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setTab(tab.id)}
                    className={`relative flex h-12 w-full items-center gap-3 rounded-2xl px-3 text-left text-sm font-medium transition-colors ${
                      active ? 'bg-white/12 text-white' : 'text-gray-300 hover:bg-white/7 hover:text-white'
                    }`}
                  >
                    <Icon size={17} />
                    <span>{tab.label}</span>
                    {!!tab.badge && (
                      <span className="ml-auto rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                        {tab.badge > 99 ? '99+' : tab.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
          </aside>

          <main className="min-w-0">
            {sessionLoading ? (
              <div className="flex min-h-[420px] items-center justify-center rounded-3xl border border-white/10 bg-white/[0.04]">
                <div className="flex items-center gap-3 text-sm text-gray-300">
                  <Loader2 size={16} className="animate-spin" />
                  正在加载账号中心...
                </div>
              </div>
            ) : !session?.authenticated ? (
              <section className="space-y-4 rounded-3xl border border-white/10 bg-white/[0.04] p-5">
                <div>
                  <h2 className="text-xl font-semibold">登录 / 注册</h2>
                  <p className="mt-2 text-sm leading-7 text-gray-400">
                    使用现有邮箱注册、密码登录、验证码登录和忘记密码流程。第一个注册用户会自动成为超级管理员。
                  </p>
                </div>
                <AuthPanel session={session} onSessionChange={setSession} />
              </section>
            ) : (
              <>
                {activeTab === 'profile' && (
                  <section className="space-y-4">
                    <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                          <h2 className="text-xl font-semibold">账号资料</h2>
                          <p className="mt-2 text-sm leading-7 text-gray-400">
                            这里展示当前登录身份、账号状态、注册和活跃时间。资料修改能力后续可以接入个人资料接口。
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void refreshSession()}
                          className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 text-xs text-gray-200 hover:bg-white/10"
                        >
                          <RefreshCw size={13} />
                          刷新
                        </button>
                      </div>

                      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        <InfoCard label="显示名称" value={user?.displayName || user?.email || '-'} />
                        <InfoCard label="邮箱" value={user?.email || '-'} />
                        <InfoCard label="用户 ID" value={user?.userId || '-'} mono />
                        <InfoCard label="角色" value={roleLabel(user?.role)} />
                        <InfoCard label="账号状态" value={statusLabel(user?.status)} />
                        <InfoCard label="密码状态" value={user?.passwordConfigured ? '已设置' : '未设置'} />
                        <InfoCard label="注册时间" value={formatDateTime(user?.createdAt)} />
                        <InfoCard label="最近登录" value={formatDateTime(user?.lastLoginAt)} />
                        <InfoCard label="最近活跃" value={formatDateTime(user?.lastSeenAt)} />
                      </div>
                    </div>
                  </section>
                )}

                {activeTab === 'security' && (
                  <section className="space-y-4 rounded-3xl border border-white/10 bg-white/[0.04] p-5">
                    <div>
                      <h2 className="text-xl font-semibold">安全设置</h2>
                      <p className="mt-2 text-sm leading-7 text-gray-400">
                        复用现有账号系统：未设置密码的邮箱验证码用户可以补设密码，已设置密码的用户可以修改密码。
                      </p>
                    </div>
                    <AuthPanel session={session} onSessionChange={setSession} />
                  </section>
                )}

                {activeTab === 'wallet' && (
                  <section className="space-y-4">
                    <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h2 className="text-xl font-semibold">金币账户</h2>
                          <p className="mt-2 text-sm leading-7 text-gray-400">
                            查看当前金币、累计消费、兑换码入口；完整筛选和分页流水保留在账单中心。
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            window.location.href = '/billing';
                          }}
                          className="inline-flex h-10 items-center gap-2 rounded-xl bg-amber-400 px-4 text-sm font-semibold text-slate-950 hover:bg-amber-300"
                        >
                          <CreditCard size={15} />
                          完整账单
                        </button>
                      </div>
                    </div>
                    <BillingPanel session={session} />
                  </section>
                )}

                {activeTab === 'notifications' && (
                  <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h2 className="text-xl font-semibold">通知公告</h2>
                        <p className="mt-2 text-sm leading-7 text-gray-400">
                          数据来自现有公告系统，和右上角通知按钮共用已读状态。
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => void refreshAnnouncements()}
                          className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 text-xs text-gray-200 hover:bg-white/10"
                        >
                          <RefreshCw size={13} />
                          刷新
                        </button>
                        <button
                          type="button"
                          onClick={() => markAnnouncementsRead(announcements.map((item) => item.id))}
                          className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 text-xs text-gray-200 hover:bg-white/10"
                        >
                          <CheckCheck size={13} />
                          全部已读
                        </button>
                      </div>
                    </div>

                    <div className="mt-5 space-y-3">
                      {announcements.length === 0 ? (
                        <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-12 text-center text-sm text-gray-400">
                          暂无公告
                        </div>
                      ) : (
                        announcements.map((item) => {
                          const unread = !seenIds.includes(item.id);
                          return (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => {
                                setSelectedAnnouncement(item);
                                markAnnouncementsRead([item.id]);
                              }}
                              className="relative w-full rounded-2xl border border-white/10 bg-black/20 p-4 text-left transition-colors hover:bg-white/[0.06]"
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <Megaphone size={15} className="text-blue-300" />
                                <span className="font-semibold text-white">{item.title || '系统公告'}</span>
                                {item.pinned && (
                                  <span className="rounded-full bg-yellow-500/15 px-2 py-0.5 text-[10px] font-semibold text-yellow-300">
                                    置顶
                                  </span>
                                )}
                                {unread && <span className="h-2 w-2 rounded-full bg-red-500" />}
                              </div>
                              <div className="mt-2 line-clamp-3 text-sm leading-7 text-gray-300">{item.content}</div>
                              <div className="mt-2 text-xs text-gray-500">{formatDate(item.date)}</div>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </section>
                )}

                {activeTab === 'admin' && session.user.isAdmin && (
                  <section className="rounded-3xl border border-cyan-500/20 bg-cyan-500/10 p-5">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div>
                        <h2 className="text-xl font-semibold text-cyan-50">管理入口</h2>
                        <p className="mt-2 text-sm leading-7 text-cyan-100/75">
                          当前账号拥有后台权限，可以进入管理用户、公告、运行总览、模型和线路配置。
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          window.location.href = '/admin';
                        }}
                        className="inline-flex h-11 items-center gap-2 rounded-2xl bg-cyan-400 px-5 text-sm font-semibold text-slate-950 hover:bg-cyan-300"
                      >
                        <LayoutDashboard size={16} />
                        进入管理后台
                      </button>
                    </div>
                  </section>
                )}
              </>
            )}
          </main>
        </div>
      </div>

      {selectedAnnouncement && (
        <div className="fixed inset-0 z-[1200] grid place-items-center bg-black/65 p-4 backdrop-blur-sm" onClick={() => setSelectedAnnouncement(null)}>
          <div className="w-full max-w-xl overflow-hidden rounded-3xl border border-white/10 bg-[#18181b] shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="border-b border-white/10 p-5">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-yellow-500/10 text-yellow-300">
                  <Megaphone size={20} />
                </div>
                <div className="min-w-0">
                  <div className="truncate font-semibold text-white">{selectedAnnouncement.title || '系统公告'}</div>
                  <div className="mt-1 text-xs text-gray-500">{formatDate(selectedAnnouncement.date)}</div>
                </div>
              </div>
            </div>
            <div className="max-h-[55vh] overflow-y-auto p-5">
              <div className="whitespace-pre-wrap text-sm leading-7 text-gray-200">{selectedAnnouncement.content}</div>
              {!!selectedAnnouncement.images?.length && (
                <div className="mt-4 grid gap-3">
                  {selectedAnnouncement.images.map((src, index) => (
                    <img key={`${src}-${index}`} src={src} alt={`announcement-${index + 1}`} className="max-h-72 w-full rounded-2xl border border-white/10 object-contain" />
                  ))}
                </div>
              )}
            </div>
            <div className="flex justify-end border-t border-white/10 p-4">
              <button
                type="button"
                onClick={() => setSelectedAnnouncement(null)}
                className="h-10 rounded-xl bg-yellow-400 px-5 text-sm font-semibold text-slate-950 hover:bg-yellow-300"
              >
                我知道了
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const InfoCard: React.FC<{ label: string; value: string; mono?: boolean }> = ({ label, value, mono }) => (
  <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
    <div className="text-xs text-gray-500">{label}</div>
    <div className={`mt-2 break-words text-sm font-semibold text-gray-100 ${mono ? 'font-mono' : ''}`}>{value}</div>
  </div>
);

export default AccountCenterPage;
