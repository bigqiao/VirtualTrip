import { useState, useEffect, useRef, type ReactNode } from "react";
import {
  Compass,
  MapPin,
  ImagePlus,
  Images,
  Users,
  Settings as SettingsIcon,
  ArrowUpRight,
  ArrowRight,
  Plus,
  Search,
  Check,
  ChevronRight,
  ChevronDown,
  X,
  Sparkles,
  Globe2,
  Sun,
  Cloud,
  CloudRain,
  Snowflake,
  Wind,
  Shirt,
  Camera,
  SlidersHorizontal,
  Heart,
  Download,
  Trash2,
  RefreshCw,
  LoaderCircle,
  CheckCircle2,
  AlertCircle,
  Navigation,
  Map as MapIcon,
  Expand,
  BookOpen,
  Upload,
  MoreHorizontal,
  Film,
  Focus,
  Clock,
  Info,
  KeyRound,
  Link as LinkIcon,
} from "lucide-react";
import { api, body } from "./api";
import type {
  Person,
  Photo,
  Location,
  Weather,
  Scene,
  EnvironmentPhoto,
  Settings,
  State,
  Outfit,
  Plan,
  Trip,
  TravelRequest,
} from "./types";
import MapView from "./MapView";
const destinations = [
  {
    name: "巴黎 · 蒙马特",
    en: "PARIS, FRANCE",
    lat: 48.8865,
    lng: 2.3393,
    country: "法国",
    tag: "街角与咖啡",
    cover:
      "https://images.unsplash.com/photo-1502602898657-3e91760cbb34?auto=format&fit=crop&w=1500&q=85",
  },
  {
    name: "京都 · 祇园",
    en: "KYOTO, JAPAN",
    lat: 35.003,
    lng: 135.778,
    country: "日本",
    tag: "慢下来，走一走",
    cover:
      "https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?auto=format&fit=crop&w=1500&q=85",
  },
  {
    name: "雷克雅未克",
    en: "REYKJAVÍK, ICELAND",
    lat: 64.1466,
    lng: -21.9426,
    country: "冰岛",
    tag: "去追一阵北方的风",
    cover:
      "https://images.unsplash.com/photo-1476610182048-b716b8518aae?auto=format&fit=crop&w=1200&q=85",
  },
  {
    name: "纽约 · 布鲁克林",
    en: "NEW YORK, USA",
    lat: 40.7033,
    lng: -73.9881,
    country: "美国",
    tag: "电影里的日常",
    cover:
      "https://images.unsplash.com/photo-1518391846015-55a9cc003b25?auto=format&fit=crop&w=1200&q=85",
  },
];
const blankSettings: Settings = {
  llm: {
    baseUrl: "http://127.0.0.1:8317/v1",
    model: "gpt-6-luna",
    imageModel: "gpt-image-2.5-flare",
    configured: false,
  },
  google: { configured: false },
};
function Avatar({
  person,
  size = "normal",
}: {
  person: Person;
  size?: string;
}) {
  return (
    <div className={`avatar ${size}`}>
      {person.avatar ? (
        <img src={person.avatar} alt={person.name} />
      ) : (
        <span>{person.name.slice(0, 1)}</span>
      )}
    </div>
  );
}
function WeatherIcon({ code = 0 }: { code?: number }) {
  return code >= 71 && code <= 86 ? (
    <Snowflake size={18} />
  ) : code >= 51 ? (
    <CloudRain size={18} />
  ) : code > 0 ? (
    <Cloud size={18} />
  ) : (
    <Sun size={18} />
  );
}
function weatherText(code = 0) {
  return code >= 71 && code <= 86
    ? "降雪"
    : code >= 51
      ? "有降水"
      : code > 2
        ? "阴天"
        : code > 0
          ? "多云"
          : "晴朗";
}
function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTarget =
      ref.current?.querySelector<HTMLElement>(
        'input:not([hidden]):not([type="hidden"]),textarea,select',
      ) || ref.current;
    focusTarget?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const els = ref.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input,select,textarea,a[href],[tabindex="0"]',
        );
        if (!els?.length) return;
        const first = els[0],
          last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = old;
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
      >
        <div className="modal-header">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-btn" aria-label="关闭" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
export default function App() {
  const [page, setPage] = useState("travel");
  const [state, setState] = useState<State>({
    people: [],
    photos: [],
    trips: [],
    settings: blankSettings,
  });
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [toast, setToast] = useState("");
  const [modal, setModal] = useState<"person" | "upload" | null>(null);
  const [editPerson, setEditPerson] = useState<Person | null>(null);
  const [uploadPerson, setUploadPerson] = useState("");
  const [detailPhoto, setDetailPhoto] = useState<Photo | null>(null);
  const [detailTrip, setDetailTrip] = useState<Trip | null>(null);
  const [confirm, setConfirm] = useState<{
    text: string;
    action: () => Promise<void>;
  } | null>(null);
  const previousTripStates = useRef<Map<string, string>>(new Map());
  const refresh = async () => {
    try {
      const next = await api<State>("/state");
      for (const trip of next.trips) {
        const previous = previousTripStates.current.get(trip.id);
        if (
          previous &&
          ["queued", "running"].includes(previous) &&
          trip.status === "completed"
        )
          setToast(`「${trip.title}」已生成，新的回忆已收入旅行相册。`);
        if (
          previous &&
          ["queued", "running"].includes(previous) &&
          trip.status === "failed"
        )
          setToast(`「${trip.title}」生成失败，可到旅行相册查看原因并重试。`);
      }
      previousTripStates.current = new Map(
        next.trips.map((trip) => [trip.id, trip.status]),
      );
      setState(next);
      setLoaded(true);
      setLoadError("");
    } catch (e) {
      setLoadError((e as Error).message);
    }
  };
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 3000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 5500);
    return () => clearTimeout(t);
  }, [toast]);
  const run = async (action: () => Promise<unknown>, message?: string) => {
    try {
      await action();
      await refresh();
      if (message) setToast(message);
    } catch (e) {
      setToast((e as Error).message);
    }
  };
  const openPerson = (person: Person | null = null) => {
    setEditPerson(person);
    setModal("person");
  };
  const openUpload = (id = "") => {
    if (!state.people.length) {
      openPerson();
      return;
    }
    setUploadPerson(id || state.people[0].id);
    setModal("upload");
  };
  const photo = detailPhoto
    ? state.photos.find((p) => p.id === detailPhoto.id) || detailPhoto
    : null;
  const selectedTrip = detailTrip
    ? state.trips.find((t) => t.id === detailTrip.id) || detailTrip
    : null;
  const count = state.trips.filter((t) => t.status === "completed").length;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setPage("travel");
          }}
        >
          <div className="brand-icon">
            <Compass size={27} />
          </div>
          <span>
            VirtualTrip<small>让远方成为日常</small>
          </span>
        </a>
        <div className="sidebar-label">你的旅行空间</div>
        <nav>
          {[
            { id: "travel", icon: Compass, name: "旅行工作台" },
            {
              id: "library",
              icon: Users,
              name: "人物与照片库",
              count: state.people.length,
            },
            { id: "album", icon: Images, name: "旅行相册", count },
          ].map((item) => (
            <button
              key={item.id}
              aria-label={item.name}
              className={`nav-item ${page === item.id ? "active" : ""}`}
              onClick={() => setPage(item.id)}
            >
              <item.icon size={19} />
              <span>{item.name}</span>
              {item.count !== undefined && <em>{item.count}</em>}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <div className="note-orbit">
            <Globe2 size={25} />
            <span>✦</span>
          </div>
          <h3>世界很大，回忆很近。</h3>
          <p>
            带上熟悉的人，
            <br />
            把想去的地方变成生活照。
          </p>
          <button onClick={() => setPage("travel")}>
            开启一段旅行 <ArrowRight size={15} />
          </button>
        </div>
        <div className="sidebar-bottom">
          <button
            aria-label="设置与连接"
            className={`nav-item ${page === "settings" ? "active" : ""}`}
            onClick={() => setPage("settings")}
          >
            <SettingsIcon size={18} />
            <span>设置与连接</span>
            {!state.settings.google.configured && <span className="dot" />}
          </button>
          <div className="local-badge">
            <span
              className={
                state.settings.llm.configured
                  ? "status-dot"
                  : "status-dot muted"
              }
            />
            <div>
              私人旅行空间<small>照片保存在本机</small>
            </div>
            <div className="user-initial">我</div>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div>
            <span className="breadcrumb">我的空间</span>
            <ChevronRight size={13} />
            <span>
              {page === "travel"
                ? "旅行工作台"
                : page === "library"
                  ? "人物与照片库"
                  : page === "album"
                    ? "旅行相册"
                    : "设置与连接"}
            </span>
          </div>
          <div className="topbar-right">
            <span>
              <span className="status-dot" /> LOCAL WORKSPACE
            </span>
            <button
              className="icon-btn"
              aria-label="打开设置"
              onClick={() => setPage("settings")}
            >
              <SlidersHorizontal size={18} />
            </button>
          </div>
        </header>
        <main>
          {loadError && (
            <div className="notice error">
              <AlertCircle size={17} />
              <span>无法连接本地服务：{loadError}</span>
              <button onClick={() => void refresh()}>重试</button>
            </div>
          )}
          {loaded && (
            <div hidden={page !== "travel"}>
              <Travel
                state={state}
                onUpload={openUpload}
                onPerson={() => openPerson()}
                onAlbum={() => setPage("album")}
                refresh={refresh}
                notify={setToast}
                onSettings={() => setPage("settings")}
              />
            </div>
          )}
          {!loaded && !loadError ? (
            <div className="loading-full">
              <LoaderCircle className="spin" />
              正在打开你的旅行空间…
            </div>
          ) : page === "travel" ? null : page === "library" ? (
            <Library
              state={state}
              onUpload={openUpload}
              onPerson={openPerson}
              onPhoto={setDetailPhoto}
              onDeletePerson={(p) =>
                setConfirm({
                  text: `删除「${p.name}」及其 ${p.photoCount} 张原始照片？已经生成的旅行相片会保留。`,
                  action: async () => {
                    await api(`/people/${p.id}`, { method: "DELETE" });
                    await refresh();
                  },
                })
              }
            />
          ) : page === "album" ? (
            <Album
              state={state}
              onTrip={setDetailTrip}
              onTravel={() => setPage("travel")}
              run={run}
            />
          ) : (
            <SettingsPage
              settings={state.settings}
              refresh={refresh}
              notify={setToast}
            />
          )}
        </main>
        <footer className="footer">
          <span>
            VirtualTrip <span className="footer-dot">•</span>{" "}
            一张照片，一种可能。
          </span>
          <span>
            <span className="status-dot" /> 你的回忆，由你保管
          </span>
        </footer>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Info size={18} />
          <span>{toast}</span>
          <button aria-label="关闭提示" onClick={() => setToast("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {modal === "person" && (
        <PersonModal
          person={editPerson}
          onClose={() => setModal(null)}
          onSave={async (name, note) => {
            await api(editPerson ? `/people/${editPerson.id}` : "/people", {
              method: editPerson ? "PATCH" : "POST",
              body: body({ name, note }),
            });
            await refresh();
            setModal(null);
            setToast(
              editPerson ? "人物资料已更新" : "人物已创建，可以上传照片了",
            );
          }}
        />
      )}
      {modal === "upload" && (
        <UploadModal
          people={state.people}
          initialPerson={uploadPerson}
          onClose={() => setModal(null)}
          onSave={async (form) => {
            const result = await api<{ ids: string[]; errors: string[] }>(
              "/photos",
              { method: "POST", body: form },
            );
            await refresh();
            setModal(null);
            setToast(
              `${result.ids.length} 张照片已上传，正在分析衣着与特征。${result.errors.join(" ")}`,
            );
          }}
        />
      )}
      {photo && (
        <PhotoDetail
          photo={photo}
          onClose={() => setDetailPhoto(null)}
          onRetry={() =>
            run(
              () => api(`/photos/${photo.id}/retry`, { method: "POST" }),
              "已重新加入分析队列",
            )
          }
          onDelete={() =>
            setConfirm({
              text: "删除这张原始照片和它的分析索引？",
              action: async () => {
                await api(`/photos/${photo.id}`, { method: "DELETE" });
                setDetailPhoto(null);
                await refresh();
              },
            })
          }
        />
      )}{" "}
      {selectedTrip && (
        <TripDetail
          trip={selectedTrip}
          onClose={() => setDetailTrip(null)}
          run={run}
          onDelete={() =>
            setConfirm({
              text: "删除这张旅行照片？此操作会同时删除本机图片。",
              action: async () => {
                await api(`/trips/${selectedTrip.id}`, { method: "DELETE" });
                setDetailTrip(null);
                await refresh();
              },
            })
          }
        />
      )}{" "}
      {confirm && (
        <Modal title="确认删除" onClose={() => setConfirm(null)}>
          <p className="confirm-copy">{confirm.text}</p>
          <div className="modal-actions">
            <button
              className="button secondary"
              onClick={() => setConfirm(null)}
            >
              取消
            </button>
            <button
              className="button danger"
              onClick={() => {
                const action = confirm.action;
                setConfirm(null);
                void run(action, "已删除");
              }}
            >
              确认删除
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function sceneLabel(scene?: Scene | null) {
  return scene?.source === "commons"
    ? "当地实拍参考"
    : scene?.source === "streetview"
      ? "真实街景参考"
      : "AI 想象场景";
}
function EnvironmentCredit({ photo }: { photo: EnvironmentPhoto }) {
  return (
    <div className="environment-credit">
      <a
        href={photo.sourceURL}
        target="_blank"
        rel="noreferrer"
        title={photo.title}
      >
        {photo.title.replace(/\.(jpe?g|png|webp)$/i, "")}{" "}
        <ArrowUpRight size={12} />
      </a>
      <p>
        Wikimedia Commons · {photo.author} · {photo.license}
      </p>
      <small>
        {photo.distance === null
          ? "附近地点实拍"
          : `标注地点距选点 ${photo.distance < 1000 ? `${photo.distance} 米` : `${(photo.distance / 1000).toFixed(1)} 公里`}`}
        {photo.date ? ` · 拍摄记录 ${photo.date.slice(0, 10)}` : ""} ·
        非当前天气实况
      </small>
    </div>
  );
}
function EnvironmentChoices({
  scene,
  onSelect,
  busy = false,
}: {
  scene: Scene;
  onSelect: (id: number) => void;
  busy?: boolean;
}) {
  if (!scene.candidates?.length) return null;
  return (
    <div className="environment-picker">
      <div className="environment-picker-heading">
        <strong>换一张环境参考</strong>
        <span>{scene.manual ? "你的选择" : "自动推荐 · 可手动更换"}</span>
      </div>
      <div
        className="environment-candidates"
        role="group"
        aria-label="当地环境候选照片"
      >
        {scene.candidates.map((photo, index) => (
          <button
            key={photo.id}
            disabled={busy}
            aria-label={`选择环境照片 ${index + 1}`}
            aria-pressed={scene.photo?.id === photo.id}
            title={photo.title}
            className={scene.photo?.id === photo.id ? "selected" : ""}
            onClick={() => onSelect(photo.id)}
          >
            <img src={photo.url} alt={photo.title} loading="lazy" />
            {scene.photo?.id === photo.id && (
              <span>
                <Check size={13} />
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
function EnvironmentReference({
  scene,
  onSelect,
  busy = false,
  compact = false,
}: {
  scene: Scene;
  onSelect: (id: number) => void;
  busy?: boolean;
  compact?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [scene.photo?.id]);
  if (!scene.photo) return null;
  return (
    <section
      className={`environment-reference ${compact ? "compact" : ""}`}
      aria-label="本次环境参考"
    >
      <div className="environment-image-wrap">
        {failed ? (
          <div className="environment-image-error">
            <Camera size={25} />
            <p>照片暂时无法加载，可选择其他照片</p>
          </div>
        ) : (
          <img
            className="environment-image"
            src={scene.photo.url}
            alt="本次选用的当地实拍环境照片"
            onError={() => setFailed(true)}
          />
        )}
        <span className="badge mint">当地实拍 · 环境参考</span>
      </div>
      <EnvironmentCredit photo={scene.photo} />
      {!compact && (
        <EnvironmentChoices scene={scene} onSelect={onSelect} busy={busy} />
      )}
    </section>
  );
}
function Travel({
  state,
  onUpload,
  onPerson,
  onAlbum,
  refresh,
  notify,
  onSettings,
}: {
  state: State;
  onUpload: (id?: string) => void;
  onPerson: () => void;
  onAlbum: () => void;
  refresh: () => Promise<void>;
  notify: (s: string) => void;
  onSettings: () => void;
}) {
  const [location, setLocation] = useState<Location>(destinations[0]);
  const [weather, setWeather] = useState<Weather | null>(null);
  const [scene, setScene] = useState<Scene | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [view, setView] = useState<"inspiration" | "map" | "street">("street");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Location[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [outfits, setOutfits] = useState<Record<string, Outfit>>({});
  const [outfitPerson, setOutfitPerson] = useState<Person | null>(null);
  const [style, setStyle] = useState("daily");
  const [moment, setMoment] = useState("natural");
  const [aspect, setAspect] = useState("landscape");
  const [instruction, setInstruction] = useState("");
  const [heading, setHeading] = useState(0);
  const [headingDraft, setHeadingDraft] = useState(0);
  const [environmentPhotoId, setEnvironmentPhotoId] = useState<
    number | undefined
  >();
  const [manualTemp, setManualTemp] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [activeTrip, setActiveTrip] = useState("");
  const [streetFailed, setStreetFailed] = useState(false);
  const destination = destinations.find((d) => d.name === location.name);
  const working =
    state.trips.find((t) => t.id === activeTrip) ||
    state.trips.find((t) => ["queued", "running"].includes(t.status));
  const validSelected = selected.filter((id) =>
    state.people.some((p) => p.id === id),
  );
  const request: TravelRequest = {
    environmentPhotoId,
    location,
    personIds: validSelected,
    outfits,
    temperature: manualTemp === "" ? null : Number(manualTemp),
    heading,
    style,
    moment,
    aspect,
    instruction,
  };
  useEffect(() => {
    const controller = new AbortController();
    setLocationLoading(true);
    setWeather(null);
    setScene(null);
    setStreetFailed(false);
    setEnvironmentPhotoId(undefined);
    void api<{ weather: Weather; scene: Scene; locality?: string }>(
      `/location?lat=${location.lat}&lng=${location.lng}&name=${encodeURIComponent(location.name)}`,
      { signal: controller.signal },
    )
      .then((data) => {
        setWeather(data.weather);
        setScene(data.scene);
        if (data.locality)
          setLocation((current) =>
            current.lat === location.lat &&
            current.lng === location.lng &&
            /^(地图选点|自选坐标) · -?\d/.test(current.name)
              ? { ...current, name: `地图选点 · ${data.locality}` }
              : current,
          );
      })
      .catch((e) => {
        if (e.name !== "AbortError") notify(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLocationLoading(false);
      });
    return () => controller.abort();
  }, [
    location.lat,
    location.lng,
    state.settings.google.configured,
    state.settings.environment?.provider,
  ]);
  const search = async () => {
    if (!query.trim()) return;
    const coords = query.match(
      /^\s*(-?\d+(?:\.\d+)?)\s*[,，]\s*(-?\d+(?:\.\d+)?)\s*$/,
    );
    if (coords) {
      const lat = Number(coords[1]),
        lng = Number(coords[2]);
      if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        notify("纬度应为 -90～90，经度应为 -180～180");
        return;
      }
      setLocation({
        lat,
        lng,
        name: `自选坐标 · ${lat.toFixed(4)}, ${lng.toFixed(4)}`,
      });
      setView("map");
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      const data = await api<Location[]>(
        `/locations/search?q=${encodeURIComponent(query)}`,
      );
      setResults(data);
      if (!data.length) notify("没有找到地点，试试城市英文名或直接点击地图。");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setSearching(false);
    }
  };
  const toggle = (person: Person) => {
    if (!person.readyCount) {
      onUpload(person.id);
      return;
    }
    if (!selected.includes(person.id) && validSelected.length >= 6) {
      notify("每次旅行最多选择 6 位同行人物");
      return;
    }
    setSelected((prev) =>
      prev.includes(person.id)
        ? prev.filter((id) => id !== person.id)
        : [...prev, person.id],
    );
  };
  const prepare = async () => {
    if (!validSelected.length) {
      notify("请先选择至少一位有可用照片的同行人物");
      return;
    }
    if (
      manualTemp !== "" &&
      (!Number.isFinite(Number(manualTemp)) ||
        Number(manualTemp) < -50 ||
        Number(manualTemp) > 60)
    ) {
      notify("指定温度应为 -50～60°C");
      return;
    }
    setPreparing(true);
    try {
      setPlan(
        await api<Plan>("/travel/preview", {
          method: "POST",
          body: body(request),
        }),
      );
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setPreparing(false);
    }
  };
  const selectEnvironment = async (id: number) => {
    if (plan) {
      setPreparing(true);
      try {
        const updated = await api<Plan>("/travel/preview", {
          method: "POST",
          body: body({ ...request, environmentPhotoId: id }),
        });
        setEnvironmentPhotoId(id);
        setPlan(updated);
        setScene(updated.scene);
      } catch (e) {
        notify((e as Error).message);
      } finally {
        setPreparing(false);
      }
    } else {
      const photo = scene?.candidates?.find((photo) => photo.id === id);
      if (photo && scene) {
        setEnvironmentPhotoId(id);
        setScene({
          ...scene,
          source: "commons",
          photo,
          manual: true,
          reason: "使用你选择的当地实拍照片作为环境参考。",
        });
      }
    }
  };
  const generate = async () => {
    setSubmitting(true);
    try {
      const trip = await api<Trip>("/trips", {
        method: "POST",
        body: body({ ...request, previewToken: plan?.previewToken }),
      });
      setActiveTrip(trip.id);
      setPlan(null);
      await refresh();
      notify("旅行已开始，生成完成后会自动收入相册");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };
  const usable = state.people.filter((p) => p.readyCount > 0);
  const temperature =
    manualTemp !== "" ? Number(manualTemp) : weather?.temperature;
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <span /> EVERYDAY, SOMEWHERE ELSE
          </div>
          <h1>
            下一站，去哪里<span className="orange">？</span>
          </h1>
          <p>选一个心动的坐标，和熟悉的人一起，把远方过成日常。</p>
        </div>
        <button className="button secondary" onClick={() => onUpload()}>
          <ImagePlus size={17} />
          上传生活照
        </button>
      </div>
      <div className="travel-grid">
        <div className="destination-column">
          <section className="panel destination-panel">
            <div className="section-title">
              <div>
                <span className="step">01</span>
                <h2>选择目的地</h2>
              </div>
              <span className="subtle">世界的任何一个角落</span>
            </div>
            <div className="search-wrapper">
              <form
                className="location-search"
                onSubmit={(e) => {
                  e.preventDefault();
                  void search();
                }}
              >
                <Search size={19} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索城市、街道，或输入经纬度…"
                  aria-label="搜索目的地"
                />
                <button
                  type="submit"
                  disabled={searching}
                  aria-label="查找地点"
                >
                  {searching ? (
                    <LoaderCircle size={17} className="spin" />
                  ) : (
                    <ArrowRight size={19} />
                  )}
                </button>
              </form>
              {results.length > 0 && (
                <div className="search-results">
                  {results.map((l, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        setLocation(l);
                        setView("map");
                        setResults([]);
                        setQuery("");
                      }}
                    >
                      <MapPin size={17} />
                      <span>{l.name}</span>
                      <ArrowUpRight size={15} />
                    </button>
                  ))}
                  <button
                    className="close-results"
                    onClick={() => setResults([])}
                  >
                    关闭搜索结果
                  </button>
                </div>
              )}
            </div>
            <div className="scene-view">
              <div className="view-tabs">
                <button
                  className={view === "inspiration" ? "active" : ""}
                  onClick={() => setView("inspiration")}
                >
                  <Compass size={14} />
                  目的地
                </button>
                <button
                  className={view === "map" ? "active" : ""}
                  onClick={() => setView("map")}
                >
                  <MapIcon size={14} />
                  地图选点
                </button>
                <button
                  className={view === "street" ? "active" : ""}
                  onClick={() => setView("street")}
                >
                  <Camera size={14} />
                  环境参考
                </button>
              </div>
              {view === "map" ? (
                <>
                  <MapView location={location} onPick={(l) => setLocation(l)} />
                  <div className="map-hint">
                    <Navigation size={14} /> 点击地图任意位置，选择你的下一站
                  </div>
                </>
              ) : view === "street" ? (
                scene?.source === "commons" && scene.photo ? (
                  <EnvironmentReference
                    scene={scene}
                    onSelect={(id) => void selectEnvironment(id)}
                    compact
                  />
                ) : scene?.source === "streetview" && !streetFailed ? (
                  <>
                    <img
                      className="scene-image"
                      src={`/api/streetview?lat=${location.lat}&lng=${location.lng}&heading=${heading}`}
                      alt="所选地点的 Google 街景"
                      onError={() => setStreetFailed(true)}
                    />
                    <div className="street-attribution">
                      Google Maps · {scene.copyright}
                      <span>拍摄于 {scene.date || "日期未知"}</span>
                    </div>
                    <div className="heading-control">
                      <label>镜头朝向 {headingDraft}°</label>
                      <input
                        aria-label="街景朝向"
                        type="range"
                        min="0"
                        max="360"
                        step="15"
                        value={headingDraft}
                        onChange={(e) =>
                          setHeadingDraft(Number(e.target.value))
                        }
                        onPointerUp={(e) =>
                          setHeading(Number(e.currentTarget.value))
                        }
                        onKeyUp={(e) =>
                          setHeading(Number(e.currentTarget.value))
                        }
                        onBlur={(e) =>
                          setHeading(Number(e.currentTarget.value))
                        }
                      />
                    </div>
                  </>
                ) : (
                  <div className="no-street">
                    <div className="large-orbit">
                      <Globe2 size={40} />
                      <Sparkles size={19} />
                    </div>
                    <h3>
                      {locationLoading
                        ? "正在寻找当地实拍…"
                        : "没有实拍，也能抵达。"}
                    </h3>
                    <p>
                      {locationLoading
                        ? "正在搜索所选坐标附近的照片"
                        : streetFailed
                          ? "街景图片暂时无法加载，生成时将自动重试，必要时降级为 AI 想象。"
                          : scene?.reason ||
                            "有合适实拍就参考实拍，没有则自动想象当地。"}
                    </p>
                    <span className="badge lavender">
                      <Sparkles size={12} /> 自动降级 · AI 想象当地
                    </span>
                  </div>
                )
              ) : (
                <>
                  <img
                    className="scene-image inspiration"
                    src={destination?.cover || destinations[0].cover}
                    alt={
                      destination
                        ? `${destination.name}旅行灵感`
                        : "旅行灵感图片"
                    }
                  />
                  <div className="scene-shade" />
                  <div className="inspiration-label">
                    灵感图片 · 非所选坐标实景
                  </div>
                  <div className="scene-content">
                    <div className="scene-kicker">
                      <MapPin size={14} />
                      {destination?.en || "YOUR NEXT DESTINATION"}
                    </div>
                    <h2>{location.name.split(" · ").pop()}</h2>
                    <p>{destination?.tag || "你的坐标，你的故事。"}</p>
                    <button
                      className="button white"
                      onClick={() => setView("map")}
                    >
                      在地图上选点 <ArrowUpRight size={16} />
                    </button>
                  </div>
                  <div className="scene-coordinate">
                    {location.lat.toFixed(4)}° {location.lat >= 0 ? "N" : "S"}
                    <br />
                    {Math.abs(location.lng).toFixed(4)}°{" "}
                    {location.lng >= 0 ? "E" : "W"}
                  </div>
                </>
              )}
            </div>
            {view === "street" && scene?.candidates?.length ? (
              <EnvironmentChoices
                scene={scene}
                onSelect={(id) => void selectEnvironment(id)}
                busy={preparing || submitting}
              />
            ) : null}
            <div className="location-strip">
              <div>
                <MapPin size={19} className="orange" />
                <div>
                  <strong>{location.name}</strong>
                  <small>
                    {location.lat.toFixed(5)}, {location.lng.toFixed(5)}
                  </small>
                </div>
              </div>
              <div className="weather-mini">
                {locationLoading ? (
                  <LoaderCircle className="spin" size={17} />
                ) : weather?.status === "ok" ? (
                  <>
                    <WeatherIcon code={weather.code} />
                    <strong>{Math.round(weather.temperature!)}°C</strong>
                    <span>{weatherText(weather.code)}</span>
                  </>
                ) : (
                  <span>天气暂未知</span>
                )}
              </div>
            </div>
            <div className="source-note">
              <span
                className={`status-dot ${scene?.source && scene.source !== "imagined" ? "" : "muted"}`}
              />
              {locationLoading
                ? "正在寻找实拍与当地天气…"
                : scene?.source === "commons"
                  ? scene.manual
                    ? "使用你选择的当地实拍环境参考"
                    : "附近实拍可用，出发前由 AI 挑选环境参考"
                  : scene?.source === "streetview"
                    ? "已找到真实街景，将作为生成参考"
                    : "没有合适实拍时，自动由 AI 想象当地画面"}
              {scene?.source && scene.source !== "imagined" && (
                <span className="badge mint">
                  {scene.source === "commons" ? "免费实拍" : "真实街景"}
                </span>
              )}
            </div>
          </section>
          <div className="discover-heading">
            <h3>一点旅行灵感</h3>
            <span>
              从熟悉的向往开始 <ArrowUpRight size={14} />
            </span>
          </div>
          <div className="destination-cards">
            {destinations.slice(1).map((d) => (
              <button
                key={d.name}
                className={`destination-card ${location.name === d.name ? "selected" : ""}`}
                onClick={() => {
                  setLocation(d);
                  setView("street");
                  setQuery("");
                  setResults([]);
                }}
              >
                <img
                  src={d.cover
                    .replace("w=1500", "w=600")
                    .replace("w=1200", "w=600")}
                  alt={d.name}
                />
                <div className="card-shade" />
                <span>
                  {d.country}
                  <strong>{d.name.split(" · ")[0]}</strong>
                </span>
                <div className="destination-arrow">
                  <ArrowUpRight size={16} />
                </div>
              </button>
            ))}
          </div>
          <div className="tip-strip">
            <div>
              <Sparkles size={19} />
            </div>
            <p>
              <strong>每一次出发，都更像你。</strong>
              <span>
                当地实拍优先，衣着随天气匹配。没有实拍的远方，交给想象。
              </span>
            </p>
          </div>
        </div>
        <div className="configuration-column">
          <section className="panel people-panel">
            <div className="section-title">
              <div>
                <span className="step">02</span>
                <h2>和谁一起出发</h2>
              </div>
              <span className="count-label">{validSelected.length} / 6</span>
            </div>
            <p className="section-description">
              每人优先参考 3 张生活照，保留更多人物细节。
            </p>
            {state.people.length ? (
              <div className="traveler-grid">
                {state.people.map((person) => (
                  <button
                    key={person.id}
                    className={`traveler ${selected.includes(person.id) ? "selected" : ""}`}
                    onClick={() => toggle(person)}
                  >
                    <div className="traveler-avatar">
                      <Avatar person={person} size="large" />
                      {selected.includes(person.id) && (
                        <span className="selection-check">
                          <Check size={11} />
                        </span>
                      )}
                    </div>
                    <strong>{person.name}</strong>
                    <small>
                      {person.readyCount
                        ? `${person.readyCount} 张可用`
                        : "待上传照片"}
                    </small>
                  </button>
                ))}
                <button className="traveler add-traveler" onClick={onPerson}>
                  <div className="add-circle">
                    <Plus size={21} />
                  </div>
                  <strong>添加人物</strong>
                  <small>一起创造回忆</small>
                </button>
              </div>
            ) : (
              <div className="people-empty">
                <div className="empty-avatars">
                  <span>
                    <Users size={22} />
                  </span>
                  <span>
                    <Plus size={20} />
                  </span>
                </div>
                <h3>先把熟悉的人带进来</h3>
                <p>为自己、家人或朋友建立照片档案。</p>
                <button className="button secondary small" onClick={onPerson}>
                  <Plus size={15} />
                  添加第一位人物
                </button>
              </div>
            )}
            <div className="wardrobe-heading">
              <Shirt size={16} />
              <strong>智能衣着搭配</strong>
              <span className="badge mint">自动匹配</span>
            </div>
            <div className="wardrobe-note">
              <Sun size={16} />
              <p>
                {temperature !== null && temperature !== undefined
                  ? `结合目的地与 ${Math.round(temperature)}°C 选择衣着`
                  : "根据可用天气匹配；天气未知时使用分层穿搭"}
                <small>
                  先筛天气与活动，再由 AI 选衣。没有合适穿搭时重新搭配。
                </small>
              </p>
            </div>
            {validSelected.length > 0 && (
              <div className="outfit-list">
                {validSelected.map((id) => {
                  const person = state.people.find((p) => p.id === id)!;
                  return (
                    <button key={id} onClick={() => setOutfitPerson(person)}>
                      <Avatar person={person} size="tiny" />
                      <span>
                        {person.name}
                        <small>
                          {outfits[id]?.instruction || outfits[id]?.photoId
                            ? "已手动指定衣着"
                            : "自动选择合适的衣着"}
                        </small>
                      </span>
                      <SlidersHorizontal size={15} />
                    </button>
                  );
                })}
              </div>
            )}
            <p className="override-tip">
              想穿得特别一点？选中人物后可手动指定。
            </p>
          </section>
          <section className="panel mood-panel">
            <div className="section-title">
              <div>
                <span className="step">03</span>
                <h2>这次的旅行氛围</h2>
              </div>
              <Camera size={17} className="subtle" />
            </div>
            <label className="field-label">照片风格</label>
            <div className="style-options">
              {[
                { id: "daily", icon: Camera, label: "日常抓拍" },
                { id: "film", icon: Film, label: "胶片记忆" },
                { id: "editorial", icon: Focus, label: "旅拍写真" },
              ].map((s) => (
                <button
                  key={s.id}
                  className={style === s.id ? "selected" : ""}
                  onClick={() => setStyle(s.id)}
                >
                  <s.icon size={19} />
                  <span>{s.label}</span>
                </button>
              ))}
            </div>
            <label className="field-label" htmlFor="trip-instruction">
              留下一个想法 <span>可选</span>
            </label>
            <textarea
              id="trip-instruction"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              maxLength={2000}
              placeholder="比如：在街角买杯咖啡，像朋友随手拍下的一瞬间…"
              rows={3}
            />
            <button
              className="advanced-toggle"
              onClick={() => setShowAdvanced(!showAdvanced)}
            >
              <SlidersHorizontal size={14} />
              更多创作选项
              <ChevronDown size={15} className={showAdvanced ? "rotate" : ""} />
            </button>
            {showAdvanced && (
              <div className="advanced-fields">
                <label>
                  画面比例
                  <select
                    value={aspect}
                    onChange={(e) => setAspect(e.target.value)}
                  >
                    <option value="landscape">横向 3:2</option>
                    <option value="portrait">纵向 2:3</option>
                    <option value="square">方形 1:1</option>
                  </select>
                </label>
                <label>
                  光线偏好
                  <select
                    value={moment}
                    onChange={(e) => setMoment(e.target.value)}
                  >
                    <option value="natural">自然光线</option>
                    <option value="morning">清晨</option>
                    <option value="golden">日落时分</option>
                    <option value="night">夜晚</option>
                  </select>
                </label>
                <label className="full">
                  指定目的地温度（°C）
                  <input
                    type="number"
                    min="-50"
                    max="60"
                    value={manualTemp}
                    onChange={(e) => setManualTemp(e.target.value)}
                    placeholder="留空使用当地当前天气"
                  />
                  <small>用于模拟不同季节；不会将当前天气当作未来预报。</small>
                </label>
              </div>
            )}
          </section>
          <div className="generate-area">
            <button
              className="button primary generate-button"
              disabled={
                preparing ||
                locationLoading ||
                submitting ||
                (working && ["running", "queued"].includes(working.status)) ||
                !validSelected.length
              }
              onClick={() => void prepare()}
            >
              {preparing ? (
                <LoaderCircle size={19} className="spin" />
              ) : (
                <Sparkles size={19} />
              )}{" "}
              {preparing ? "正在匹配参考照片…" : "准备我的虚拟旅行"}
              <ArrowRight size={18} />
            </button>
            <p>
              {validSelected.length
                ? `带上 ${validSelected.map((id) => state.people.find((p) => p.id === id)?.name).join("、")}，去 ${location.name}`
                : "添加人物并上传照片，就可以出发了"}
            </p>
          </div>
          {working && (
            <div className={`job-card ${working.status}`}>
              <div>
                {working.status === "completed" ? (
                  <CheckCircle2 size={21} />
                ) : working.status === "failed" ? (
                  <AlertCircle size={21} />
                ) : (
                  <LoaderCircle className="spin" size={21} />
                )}
                <div>
                  <strong>{working.stage}</strong>
                  <p>
                    {working.status === "completed"
                      ? "这段新回忆已经为你保存。"
                      : working.status === "failed"
                        ? working.error
                        : "图片生成通常需要几分钟，可继续浏览照片库。"}
                  </p>
                </div>
              </div>
              {working.status === "completed" && (
                <button onClick={onAlbum}>
                  去相册看看 <ArrowRight size={15} />
                </button>
              )}
              {working.status === "failed" && (
                <button
                  onClick={() => {
                    void api(`/trips/${working.id}/retry`, { method: "POST" })
                      .then(refresh)
                      .catch((e) => notify(e.message));
                  }}
                >
                  重试生成 <RefreshCw size={14} />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      {plan && (
        <Modal
          title="出发前，确认这一刻"
          subtitle="参考照片、衣着和场景来源都为你准备好了。"
          onClose={() => {
            if (!submitting && !preparing) setPlan(null);
          }}
          wide
        >
          <div className="preview-location">
            <MapPin size={20} />
            <div>
              <strong>{location.name}</strong>
              <p>
                {plan.temperature === null
                  ? "天气未知，使用保守分层穿搭"
                  : `${plan.temperature}°C · ${plan.temperatureSource === "manual" ? "你指定的温度" : "当前天气"}`}
              </p>
            </div>
            <span
              className={`badge ${plan.scene.source !== "imagined" ? "mint" : "lavender"}`}
            >
              {sceneLabel(plan.scene)}
            </span>
          </div>
          {plan.scene.reason && (
            <p className="preview-reason">{plan.scene.reason}</p>
          )}
          {plan.scene.source === "commons" && plan.scene.photo ? (
            <EnvironmentReference
              scene={plan.scene}
              onSelect={(id) => void selectEnvironment(id)}
              busy={preparing || submitting}
            />
          ) : plan.scene.candidates?.length ? (
            <EnvironmentChoices
              scene={plan.scene}
              onSelect={(id) => void selectEnvironment(id)}
              busy={preparing || submitting}
            />
          ) : null}
          {preparing && (
            <p className="environment-updating">
              <LoaderCircle size={14} className="spin" />
              正在更新环境参考…
            </p>
          )}
          <div
            className={`reference-grid ${plan.selected.length === 1 ? "single-person" : plan.selected.length === 2 ? "two-people" : ""}`}
          >
            {plan.selected.map((p) => (
              <div className="reference-card" key={p.personId}>
                <div className="reference-primary">
                  <img src={p.url} alt={`${p.name}的主要参考照片`} />
                  <span className="badge">
                    {p.adapt ? "主参考 · 仅外貌" : "主参考 · 衣着与外貌"}
                  </span>
                </div>
                <div className="reference-copy">
                  <strong>{p.name}</strong>
                  <span className={`badge ${p.manual ? "sand" : "mint"}`}>
                    {p.manual
                      ? "手动指定"
                      : p.adapt
                        ? "重新搭配衣着"
                        : p.selectionMethod === "llm"
                          ? "AI 场景选衣"
                          : p.selectionMethod === "fallback"
                            ? "规则选衣"
                            : "天气与活动匹配"}
                  </span>
                  <small className="reference-count">
                    {p.references?.length || 1} 张人物参考
                  </small>
                  <p>{p.reason}</p>
                  {(p.references?.length || 0) > 1 && (
                    <div className="supplementary-references">
                      {p.references!.slice(1).map((ref, index) => (
                        <figure key={ref.photoId}>
                          <img
                            src={ref.url}
                            alt={`${p.name}的补充外貌参考 ${index + 1}`}
                          />
                          <figcaption>仅参考外貌</figcaption>
                        </figure>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="notice">
            <Info size={17} />
            <span>
              人物外貌来自你的照片；生成结果属于 AI
              创作。补充照片仅帮助还原外貌，衣着按主参考或你的指定处理，动作与视线随新场景自然调整。无法取得环境参考时，会自动想象当地画面。
            </span>
          </div>
          <div className="modal-actions">
            <button
              className="button secondary"
              disabled={submitting || preparing}
              onClick={() => setPlan(null)}
            >
              再调整一下
            </button>
            <button
              className="button primary"
              disabled={submitting || preparing}
              onClick={() => void generate()}
            >
              {submitting ? (
                <LoaderCircle className="spin" size={17} />
              ) : (
                <Sparkles size={17} />
              )}
              确认并生成生活照
            </button>
          </div>
        </Modal>
      )}
      {outfitPerson && (
        <OutfitModal
          person={outfitPerson}
          photos={state.photos.filter(
            (p) =>
              p.personId === outfitPerson.id &&
              p.status === "ready" &&
              p.analysis?.hasPerson,
          )}
          value={outfits[outfitPerson.id] || {}}
          onClose={() => setOutfitPerson(null)}
          onSave={(value) => {
            setOutfits((prev) => ({ ...prev, [outfitPerson.id]: value }));
            setOutfitPerson(null);
          }}
        />
      )}
    </>
  );
}
function Library({
  state,
  onUpload,
  onPerson,
  onPhoto,
  onDeletePerson,
}: {
  state: State;
  onUpload: (id?: string) => void;
  onPerson: (p?: Person) => void;
  onPhoto: (p: Photo) => void;
  onDeletePerson: (p: Person) => void;
}) {
  const [personId, setPersonId] = useState("all");
  const [q, setQ] = useState("");
  const [searchIds, setSearchIds] = useState<Set<string> | null>(null);
  const [season, setSeason] = useState("all");
  const [status, setStatus] = useState("all");
  useEffect(() => {
    if (!q.trim()) {
      setSearchIds(null);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void api<Photo[]>(`/photos/search?q=${encodeURIComponent(q.trim())}`, {
        signal: controller.signal,
      })
        .then((results) => setSearchIds(new Set(results.map((p) => p.id))))
        .catch(() => {});
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q, state.photos.filter((p) => p.status === "ready").length]);
  const filtered = state.photos.filter(
    (p) =>
      (!q.trim() || !searchIds || searchIds.has(p.id)) &&
      (personId === "all" || p.personId === personId) &&
      (status === "all" || p.status === status) &&
      (season === "all" ||
        p.analysis?.seasons.some((s) => s.includes(season))) &&
      q
        .trim()
        .split(/\s+/)
        .every((token) =>
          [
            p.personName,
            p.originalName,
            p.analysis?.description,
            p.analysis?.appearance,
            p.analysis?.outfit,
            ...(p.analysis?.tags || []),
            ...(p.analysis?.style || []),
            ...(p.analysis?.colors || []),
          ]
            .join(" ")
            .toLowerCase()
            .includes(token.toLowerCase()),
        ),
  );
  const person = state.people.find((p) => p.id === personId);
  const analyzing = state.photos.filter((p) =>
    ["queued", "analyzing"].includes(p.status),
  ).length;
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <span /> THE PEOPLE IN YOUR STORIES
          </div>
          <h1>
            熟悉的人，熟悉的你<span className="orange">。</span>
          </h1>
          <p>收藏生活里的样子，让每一次出发，都保留真实的个性。</p>
        </div>
        <div className="heading-actions">
          <button className="button secondary" onClick={() => onPerson()}>
            <Plus size={16} />
            新建人物
          </button>
          <button
            className="button primary"
            onClick={() => onUpload(person?.id)}
          >
            <ImagePlus size={17} />
            上传照片
          </button>
        </div>
      </div>
      <div className="library-layout">
        <aside className="panel people-directory">
          <div className="directory-heading">
            <h3>人物档案</h3>
            <span>{state.people.length}</span>
          </div>
          <button
            className={`directory-item ${personId === "all" ? "active" : ""}`}
            onClick={() => setPersonId("all")}
          >
            <span className="directory-all">
              <Users size={18} />
            </span>
            <span>
              全部人物<small>所有生活照片</small>
            </span>
            <em>{state.photos.length}</em>
          </button>
          {state.people.map((p) => (
            <button
              className={`directory-item ${personId === p.id ? "active" : ""}`}
              key={p.id}
              onClick={() => setPersonId(p.id)}
            >
              <Avatar person={p} />
              <span>
                {p.name}
                <small>{p.readyCount} 张已分析</small>
              </span>
              <em>{p.photoCount}</em>
            </button>
          ))}
          <button className="directory-add" onClick={() => onPerson()}>
            <Plus size={16} />
            添加人物
          </button>
          <div className="index-note">
            <Sparkles size={17} />
            <strong>你的私人穿搭索引</strong>
            <p>
              上传后自动提取衣着、颜色、风格与适宜温度。搜索「米色
              风衣」，就能找回那一套。
            </p>
          </div>
        </aside>
        <div className="library-main">
          {person && (
            <div className="person-summary">
              <Avatar person={person} size="large" />
              <div>
                <h2>{person.name}</h2>
                <p>{person.note || "每一张生活照，都是下次旅行的灵感。"}</p>
              </div>
              <button
                className="icon-btn"
                aria-label="编辑人物"
                onClick={() => onPerson(person)}
              >
                <SlidersHorizontal size={17} />
              </button>
              <button
                className="icon-btn"
                aria-label="删除人物"
                onClick={() => onDeletePerson(person)}
              >
                <Trash2 size={17} />
              </button>
            </div>
          )}
          <div className="library-toolbar">
            <div className="search-input">
              <Search size={18} />
              <input
                aria-label="搜索照片特征"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="搜索衣着、颜色、人物或风格…"
              />
            </div>
            <select
              aria-label="按季节筛选"
              value={season}
              onChange={(e) => setSeason(e.target.value)}
            >
              <option value="all">全部季节</option>
              {["春", "夏", "秋", "冬"].map((s) => (
                <option key={s} value={s}>
                  {s}季
                </option>
              ))}
            </select>
            <select
              aria-label="按分析状态筛选"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="all">全部状态</option>
              <option value="ready">已分析</option>
              <option value="analyzing">分析中</option>
              <option value="queued">排队中</option>
              <option value="failed">分析失败</option>
            </select>
          </div>
          <div className="result-count">
            {filtered.length} 张生活照片
            {analyzing > 0 && (
              <span>
                <LoaderCircle size={13} className="spin" />
                {analyzing} 张正在分析
              </span>
            )}
          </div>
          {filtered.length ? (
            <div className="photo-grid">
              {filtered.map((p) => (
                <button
                  className="photo-card"
                  key={p.id}
                  onClick={() => onPhoto(p)}
                >
                  <div className="photo-thumb">
                    <img
                      src={p.url}
                      alt={p.analysis?.description || p.originalName}
                    />
                    <span className={`photo-status ${p.status}`}>
                      {p.status === "ready" ? (
                        <>
                          <Check size={11} />
                          已索引
                        </>
                      ) : p.status === "failed" ? (
                        <>
                          <AlertCircle size={11} />
                          分析失败
                        </>
                      ) : (
                        <>
                          <LoaderCircle size={11} className="spin" />
                          {p.status === "queued" ? "排队中" : "分析中"}
                        </>
                      )}
                    </span>
                  </div>
                  <div className="photo-info">
                    <strong>
                      {p.personName}
                      <small>
                        {p.analysis?.style.slice(0, 2).join(" · ") ||
                          "等待 AI 分析"}
                      </small>
                    </strong>
                    {p.analysis && (
                      <p>
                        {p.analysis.hasPerson
                          ? `${p.analysis.temperatureMin}°～${p.analysis.temperatureMax}°C`
                          : "未找到可用人物"}
                        <span>{p.analysis.colors.slice(0, 2).join(" / ")}</span>
                      </p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="empty-state library-empty">
              <div className="empty-illustration">
                <Images size={40} />
                <span>
                  <Sparkles size={17} />
                </span>
              </div>
              <h2>
                {state.photos.length
                  ? "没有找到这样的照片"
                  : "把日常，变成旅行的起点。"}
              </h2>
              <p>
                {state.photos.length
                  ? "试试别的关键词，或调整人物、季节筛选。"
                  : "上传清晰的生活照，AI 会记住可见的衣着与特征，\n为你的下一次虚拟旅行找到合适的样子。"}
              </p>
              <button
                className="button primary"
                onClick={() => onUpload(person?.id)}
              >
                <ImagePlus size={17} />
                上传生活照片
              </button>
              <div className="empty-steps">
                <span>
                  <Camera size={17} />
                  上传生活照
                </span>
                <ChevronRight size={14} />
                <span>
                  <Sparkles size={17} />
                  AI 分析特征
                </span>
                <ChevronRight size={14} />
                <span>
                  <Shirt size={17} />
                  自动匹配衣着
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
function Album({
  state,
  onTrip,
  onTravel,
  run,
}: {
  state: State;
  onTrip: (t: Trip) => void;
  onTravel: () => void;
  run: (a: () => Promise<unknown>, m?: string) => Promise<void>;
}) {
  const [filter, setFilter] = useState("all");
  const [person, setPerson] = useState("all");
  const [q, setQ] = useState("");
  const trips = state.trips.filter(
    (t) =>
      (filter === "all" ||
        (filter === "favorite" && t.favorite) ||
        (filter === "active" && ["running", "queued"].includes(t.status))) &&
      (person === "all" || t.request.personIds.includes(person)) &&
      [
        t.title,
        t.request.location.name,
        ...(t.plan?.selected.map((p) => p.name) || []),
      ]
        .join(" ")
        .toLowerCase()
        .includes(q.toLowerCase()),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <span /> MEMORIES FROM EVERYWHERE
          </div>
          <h1>
            那些抵达过的远方<span className="orange">。</span>
          </h1>
          <p>一起去过的坐标，值得好好收藏。你的每段虚拟旅行，都在这里。</p>
        </div>
        <button className="button primary" onClick={onTravel}>
          <Plus size={17} />
          开启新旅行
        </button>
      </div>
      <div className="album-toolbar">
        <div className="pill-tabs">
          {[
            { id: "all", name: "全部旅行" },
            { id: "favorite", name: "我的收藏" },
            { id: "active", name: "正在生成" },
          ].map((f) => (
            <button
              key={f.id}
              className={filter === f.id ? "active" : ""}
              onClick={() => setFilter(f.id)}
            >
              {f.name}
            </button>
          ))}
        </div>
        <div className="album-filters">
          <div className="search-input">
            <Search size={17} />
            <input
              aria-label="搜索旅行相册"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索目的地或人物"
            />
          </div>
          <select
            aria-label="按同行人物筛选"
            value={person}
            onChange={(e) => setPerson(e.target.value)}
          >
            <option value="all">全部人物</option>
            {state.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      {trips.length ? (
        <div className="album-grid">
          {trips.map((t) => (
            <article key={t.id} className="trip-card">
              <button className="trip-thumbnail" onClick={() => onTrip(t)}>
                {t.url ? (
                  <img src={t.url} alt={t.title} />
                ) : (
                  <div className={`trip-generating ${t.status}`}>
                    <div>
                      {t.status === "failed" ? (
                        <AlertCircle size={36} />
                      ) : (
                        <Globe2 size={42} />
                      )}
                    </div>
                    {t.status === "failed" ? (
                      <span>这一站需要重试</span>
                    ) : (
                      <>
                        <LoaderCircle size={18} className="spin" />
                        <span>{t.stage}</span>
                      </>
                    )}
                  </div>
                )}
                <span
                  className={`trip-source badge ${t.plan?.scene.source && t.plan.scene.source !== "imagined" ? "mint" : "lavender"}`}
                >
                  {t.plan?.scene.source &&
                  t.plan.scene.source !== "imagined" ? (
                    <Camera size={12} />
                  ) : (
                    <Sparkles size={12} />
                  )}{" "}
                  {sceneLabel(t.plan?.scene)}
                </span>
              </button>
              <div className="trip-info">
                <div>
                  <button onClick={() => onTrip(t)}>
                    <h3>{t.title}</h3>
                  </button>
                  <button
                    className={`icon-btn ${t.favorite ? "favorite" : ""}`}
                    aria-label={t.favorite ? "取消收藏" : "收藏旅行"}
                    onClick={() =>
                      void run(() =>
                        api(`/trips/${t.id}`, {
                          method: "PATCH",
                          body: body({ favorite: !t.favorite }),
                        }),
                      )
                    }
                  >
                    <Heart
                      size={18}
                      fill={t.favorite ? "currentColor" : "none"}
                    />
                  </button>
                </div>
                <p>
                  <MapPin size={13} />
                  {t.request.location.name}
                </p>
                <div className="trip-meta">
                  <span>{t.plan?.selected.map((p) => p.name).join("、")}</span>
                  <time>
                    {new Date(t.createdAt).toLocaleDateString("zh-CN", {
                      timeZone: "Asia/Singapore",
                    })}
                  </time>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state album-empty">
          <div className="empty-illustration">
            <BookOpen size={42} />
            <span>
              <MapPin size={18} />
            </span>
          </div>
          <h2>
            {state.trips.length
              ? "这里还没有符合条件的旅行"
              : "第一段回忆，等你出发。"}
          </h2>
          <p>
            选择目的地和同行人物，\nAI 会把你们的日常，带到世界的另一个角落。
          </p>
          <button className="button primary" onClick={onTravel}>
            <Compass size={17} />
            去挑一个目的地
          </button>
        </div>
      )}
    </>
  );
}
function PersonModal({
  person,
  onClose,
  onSave,
}: {
  person: Person | null;
  onClose: () => void;
  onSave: (name: string, note: string) => Promise<void>;
}) {
  const [name, setName] = useState(person?.name || "");
  const [note, setNote] = useState(person?.note || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal
      title={person ? "编辑人物资料" : "让熟悉的人，一起出发"}
      subtitle="照片按人物保存，旅行时可以自由选择同行者。"
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          try {
            await onSave(name, note);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setSaving(false);
          }
        }}
      >
        <div className="person-form-avatar">
          <Users size={29} />
        </div>
        <label className="form-field">
          怎么称呼这个人
          <input
            autoFocus
            required
            maxLength={40}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：我、小雨、妈妈"
          />
        </label>
        <label className="form-field">
          人物备注 <span>可选</span>
          <textarea
            rows={3}
            maxLength={400}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="记下一些个人偏好，方便你管理照片档案。"
          />
        </label>
        <div className="notice">
          <Info size={16} />
          <span>
            人物由你来指定。上传多人合照时，可补充主体位置，避免参考错人。
          </span>
        </div>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            取消
          </button>
          <button className="button primary" disabled={saving || !name.trim()}>
            {saving ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <Plus size={16} />
            )}{" "}
            {person ? "保存资料" : "创建人物档案"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function UploadModal({
  people,
  initialPerson,
  onClose,
  onSave,
}: {
  people: Person[];
  initialPerson: string;
  onClose: () => void;
  onSave: (f: FormData) => Promise<void>;
}) {
  const [personId, setPersonId] = useState(initialPerson);
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [subject, setSubject] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const urls = files.map((file) => URL.createObjectURL(file));
    setPreviews(urls);
    return () => urls.forEach(URL.revokeObjectURL);
  }, [files]);
  const add = (incoming: File[]) => {
    const valid = incoming.filter(
      (f) =>
        ["image/jpeg", "image/png", "image/webp"].includes(f.type) &&
        f.size <= 20 * 1024 * 1024,
    );
    if (valid.length !== incoming.length)
      setError("仅支持 JPG / PNG / WebP，单张不超过 20MB。");
    else setError("");
    setFiles((prev) => [...prev, ...valid].slice(0, 12));
  };
  return (
    <Modal
      title="收藏生活里的样子"
      subtitle="清晰的脸部与完整穿搭，会让生成的你更像你。"
      onClose={onClose}
      wide
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!files.length) return;
          setBusy(true);
          setError("");
          try {
            const form = new FormData();
            form.append("personId", personId);
            form.append("subject", subject);
            files.forEach((f) => form.append("photos", f));
            await onSave(form);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="form-field">
          这些照片属于谁
          <select
            value={personId}
            onChange={(e) => setPersonId(e.target.value)}
          >
            {people.map((p) => (
              <option value={p.id} key={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <div
          className={`dropzone ${drag ? "dragging" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            add(Array.from(e.dataTransfer.files));
          }}
        >
          <div>
            <Upload size={26} />
          </div>
          <h3>把照片拖到这里</h3>
          <p>JPG、PNG、WebP · 单张最大 20MB · 每次最多 12 张</p>
          <button
            type="button"
            className="button secondary small"
            onClick={() => input.current?.click()}
          >
            <Plus size={15} />
            选择生活照片
          </button>
          <input
            ref={input}
            hidden
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => {
              add(Array.from(e.target.files || []));
              e.target.value = "";
            }}
          />
        </div>
        {files.length > 0 && (
          <div className="upload-previews">
            {files.map((f, i) => (
              <div key={`${f.name}-${i}`}>
                <img src={previews[i]} alt={f.name} />
                <button
                  type="button"
                  aria-label={`移除 ${f.name}`}
                  onClick={() =>
                    setFiles((prev) => prev.filter((_, index) => index !== i))
                  }
                >
                  <X size={13} />
                </button>
                <small>{f.name}</small>
              </div>
            ))}
          </div>
        )}
        <label className="form-field">
          照片中的主体位置 <span>单人照可留空</span>
          <input
            maxLength={400}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="例如：左边穿白色上衣的人；适用于本次所有照片"
          />
        </label>
        <div className="notice">
          <Sparkles size={16} />
          <span>
            上传后会发送给已配置的模型，分析衣着、风格与可见特征。图片保存在本机，EXIF
            信息会被移除。
          </span>
        </div>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <span className="subtle">已选 {files.length} / 12 张</span>
          <button type="button" className="button secondary" onClick={onClose}>
            取消
          </button>
          <button className="button primary" disabled={busy || !files.length}>
            {busy ? (
              <LoaderCircle size={17} className="spin" />
            ) : (
              <Sparkles size={17} />
            )}{" "}
            {busy ? "正在上传…" : "上传并分析照片"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function OutfitModal({
  person,
  photos,
  value,
  onClose,
  onSave,
}: {
  person: Person;
  photos: Photo[];
  value: Outfit;
  onClose: () => void;
  onSave: (v: Outfit) => void;
}) {
  const [mode, setMode] = useState(
    value.instruction ? "text" : value.photoId ? "photo" : "auto",
  );
  const [photoId, setPhotoId] = useState(value.photoId || "");
  const [instruction, setInstruction] = useState(value.instruction || "");
  return (
    <Modal
      title={`${person.name} · 这次穿什么`}
      subtitle="结合目的地、天气与活动选衣，也可以按你的想法来。"
      onClose={onClose}
      wide
    >
      <div className="pill-tabs outfit-mode">
        {[
          { id: "auto", label: "自动匹配" },
          { id: "photo", label: "参考某套衣着" },
          { id: "text", label: "自定义穿搭" },
        ].map((m) => (
          <button
            key={m.id}
            className={mode === m.id ? "active" : ""}
            onClick={() => setMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>
      {mode === "auto" ? (
        <div className="outfit-auto">
          <Shirt size={34} />
          <h3>把合适的衣着交给 AI</h3>
          <p>
            先按天气和活动筛选，再由 AI 比较合适的穿搭。
            <br />
            没有合适衣着时，保留外貌并为当地重新搭配。
          </p>
        </div>
      ) : mode === "photo" ? (
        <>
          <p className="subtle">
            选中一套衣着，即使与当地天气不符，也会按你的选择生成。
          </p>
          <div className="outfit-photo-grid">
            {photos.map((p) => (
              <button
                key={p.id}
                className={photoId === p.id ? "selected" : ""}
                onClick={() => setPhotoId(p.id)}
              >
                <img src={p.url} alt={p.analysis?.outfit} />
                {photoId === p.id && (
                  <span>
                    <Check size={15} />
                  </span>
                )}
                <p>{p.analysis?.outfit}</p>
              </button>
            ))}
          </div>
        </>
      ) : (
        <label className="form-field">
          你希望的穿搭
          <textarea
            rows={4}
            maxLength={1000}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="例如：即使是冬天，也一定穿照片里的白色短袖和牛仔短裤。"
          />
          <small>手动指定的衣着优先于天气自动匹配。</small>
        </label>
      )}
      <div className="modal-actions">
        <button className="button secondary" onClick={onClose}>
          取消
        </button>
        <button
          className="button primary"
          disabled={
            (mode === "photo" && !photoId) ||
            (mode === "text" && !instruction.trim())
          }
          onClick={() =>
            onSave(
              mode === "auto"
                ? {}
                : mode === "photo"
                  ? { photoId }
                  : { instruction },
            )
          }
        >
          <Check size={16} />
          保存衣着选择
        </button>
      </div>
    </Modal>
  );
}
function PhotoDetail({
  photo,
  onClose,
  onRetry,
  onDelete,
}: {
  photo: Photo;
  onClose: () => void;
  onRetry: () => void;
  onDelete: () => void;
}) {
  const a = photo.analysis;
  return (
    <Modal
      title={`${photo.personName}的生活照`}
      subtitle={photo.originalName}
      onClose={onClose}
      wide
    >
      <div className="photo-detail">
        <img
          className="detail-image"
          src={photo.url}
          alt={a?.description || photo.originalName}
        />
        <div className="analysis-detail">
          {a ? (
            <>
              <span className="badge mint">
                <Sparkles size={12} />
                AI 特征索引
              </span>
              <h3>{a.style.join(" · ")}</h3>
              <p>{a.description}</p>
              <dl>
                <dt>可见特征</dt>
                <dd>{a.appearance}</dd>
                <dt>衣着与配饰</dt>
                <dd>{a.outfit}</dd>
                <dt>适宜温度</dt>
                <dd>
                  {a.temperatureMin}°C ～ {a.temperatureMax}°C{" "}
                  <small>根据衣着推测</small>
                </dd>
                <dt>适宜季节</dt>
                <dd>{a.seasons.join(" / ")}</dd>
                <dt>主要颜色</dt>
                <dd>{a.colors.join(" / ")}</dd>
              </dl>
              <div className="tags">
                {a.tags.map((t, i) => (
                  <span key={i}>{t}</span>
                ))}
              </div>
              {(!a.hasPerson || a.warnings.length > 0) && (
                <div className="notice warning">
                  <AlertCircle size={17} />
                  <span>
                    {!a.hasPerson
                      ? "未找到可用于生成的人物，请上传清晰的人像。 "
                      : ""}
                    {a.warnings.join("；")}
                  </span>
                </div>
              )}
            </>
          ) : (
            <div className="analysis-pending">
              {photo.status === "failed" ? (
                <AlertCircle size={29} />
              ) : (
                <LoaderCircle className="spin" size={29} />
              )}
              <h3>
                {photo.status === "failed"
                  ? "分析暂未完成"
                  : "正在建立照片索引"}
              </h3>
              <p>{photo.error || "AI 正在提取可见特征与穿搭信息。"}</p>
            </div>
          )}
        </div>
      </div>
      <div className="modal-actions">
        <button className="button text danger-text" onClick={onDelete}>
          <Trash2 size={16} />
          删除照片
        </button>
        <a
          className="button secondary"
          href={photo.url}
          download={photo.originalName}
        >
          <Download size={16} />
          下载照片
        </a>
        <button
          className="button primary"
          disabled={["queued", "analyzing"].includes(photo.status)}
          onClick={onRetry}
        >
          <RefreshCw size={16} />
          {photo.status === "failed" ? "重试分析" : "重新分析"}
        </button>
      </div>
    </Modal>
  );
}
function TripDetail({
  trip,
  onClose,
  run,
  onDelete,
}: {
  trip: Trip;
  onClose: () => void;
  run: (a: () => Promise<unknown>, m?: string) => Promise<void>;
  onDelete: () => void;
}) {
  return (
    <Modal
      title={trip.title}
      subtitle={trip.request.location.name}
      onClose={onClose}
      wide
    >
      {trip.url ? (
        <img className="trip-detail-image" src={trip.url} alt={trip.title} />
      ) : (
        <div className="trip-detail-job">
          {trip.status === "failed" ? (
            <AlertCircle size={35} />
          ) : (
            <LoaderCircle className="spin" size={35} />
          )}
          <h3>{trip.stage}</h3>
          <p>{trip.error || "生成通常需要几分钟，完成后会自动保存。"}</p>
        </div>
      )}
      <div className="trip-detail-meta">
        <span
          className={`badge ${trip.plan?.scene.source && trip.plan.scene.source !== "imagined" ? "mint" : "lavender"}`}
        >
          {sceneLabel(trip.plan?.scene)} · AI 生成照片
        </span>
        <span>{trip.plan?.selected.map((p) => p.name).join("、")}</span>
        <span>
          {trip.plan?.temperature !== null
            ? `${trip.plan?.temperature}°C`
            : "天气未知"}
        </span>
        <span>
          {new Date(trip.createdAt).toLocaleString("zh-CN", {
            timeZone: "Asia/Singapore",
          })}
        </span>
      </div>
      {trip.plan?.scene.photo && (
        <div className="trip-environment-source">
          <strong>环境参考出处</strong>
          <EnvironmentCredit photo={trip.plan.scene.photo} />
        </div>
      )}
      {trip.plan?.narrative && (
        <p className="trip-scene-description">
          {trip.plan.narrative.sceneDescription}
        </p>
      )}
      <div className="modal-actions">
        <button
          className="button text danger-text"
          disabled={["running", "queued"].includes(trip.status)}
          onClick={onDelete}
        >
          <Trash2 size={16} />
          删除
        </button>
        <button
          className="button secondary"
          onClick={() =>
            void run(() =>
              api(`/trips/${trip.id}`, {
                method: "PATCH",
                body: body({ favorite: !trip.favorite }),
              }),
            )
          }
        >
          <Heart size={16} fill={trip.favorite ? "currentColor" : "none"} />
          {trip.favorite ? "已收藏" : "收藏这段旅行"}
        </button>
        {trip.status === "failed" && (
          <button
            className="button primary"
            onClick={() =>
              void run(
                () => api(`/trips/${trip.id}/retry`, { method: "POST" }),
                "已重新开始生成",
              )
            }
          >
            <RefreshCw size={16} />
            重试生成
          </button>
        )}
        {trip.url && (
          <a
            className="button primary"
            href={trip.url}
            download={`VirtualTrip-${trip.id}.jpg`}
          >
            <Download size={16} />
            下载生活照
          </a>
        )}
      </div>
    </Modal>
  );
}
function SettingsPage({
  settings,
  refresh,
  notify,
}: {
  settings: Settings;
  refresh: () => Promise<void>;
  notify: (s: string) => void;
}) {
  const [baseUrl, setBaseUrl] = useState(settings.llm.baseUrl);
  const [model, setModel] = useState(settings.llm.model);
  const [imageModel, setImageModel] = useState(settings.llm.imageModel);
  const [apiKey, setApiKey] = useState("");
  const [googleKey, setGoogleKey] = useState("");
  const [environmentProvider, setEnvironmentProvider] = useState(
    settings.environment?.provider || "commons",
  );
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    llmAvailable: boolean;
    imageAvailable: boolean;
  } | null>(null);
  const save = async () => {
    setSaving(true);
    try {
      await api("/settings", {
        method: "PUT",
        body: body({
          llm: { baseUrl, model, imageModel, apiKey },
          google: { apiKey: googleKey },
          environment: { provider: environmentProvider },
        }),
      });
      setApiKey("");
      setGoogleKey("");
      setTestResult(null);
      await refresh();
      notify("连接配置已保存");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const test = async () => {
    setTesting(true);
    try {
      const result = await api<{
        llmAvailable: boolean;
        imageAvailable: boolean;
      }>("/settings/test", { method: "POST" });
      setTestResult(result);
      notify(
        result.llmAvailable && result.imageAvailable
          ? "已保存配置连接成功，两个模型均可用"
          : "服务连接成功，但有模型不在可用列表中",
      );
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setTesting(false);
    }
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <span /> MAKE IT YOUR OWN
          </div>
          <h1>
            为旅程，连接一点可能<span className="orange">。</span>
          </h1>
          <p>配置 AI 模型与环境照片来源。密钥仅保存在本机服务端配置文件里。</p>
        </div>
      </div>
      <div className="settings-layout">
        <div className="settings-main">
          <section className="panel settings-card">
            <div className="settings-card-heading">
              <div className="settings-icon">
                <Sparkles size={22} />
              </div>
              <div>
                <h2>AI 模型服务</h2>
                <p>分析生活照，构建特征索引，生成新的旅行回忆。</p>
              </div>
              <span
                className={`badge ${settings.llm.configured ? "mint" : "sand"}`}
              >
                {settings.llm.configured ? "已配置" : "待配置"}
              </span>
            </div>
            <label className="form-field">
              API 地址
              <input
                type="url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="http://127.0.0.1:8317/v1"
              />
              <small>填写 OpenAI 兼容 API 的完整基础地址，包含 /v1。</small>
            </label>
            <label className="form-field">
              API Key
              <input
                type="password"
                autoComplete="new-password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={
                  settings.llm.configured
                    ? "已保存，留空保持原密钥"
                    : "输入 API Key"
                }
              />
            </label>
            <div className="two-fields">
              <label className="form-field">
                照片分析模型
                <input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                />
              </label>
              <label className="form-field">
                图像生成模型
                <input
                  value={imageModel}
                  onChange={(e) => setImageModel(e.target.value)}
                />
              </label>
            </div>
            <div className="settings-test">
              <button
                className="button secondary small"
                disabled={testing}
                onClick={() => void test()}
              >
                {testing ? (
                  <LoaderCircle className="spin" size={15} />
                ) : (
                  <LinkIcon size={15} />
                )}
                测试已保存的连接
              </button>
              {testResult && (
                <span className="test-results">
                  {testResult.llmAvailable && testResult.imageAvailable ? (
                    <CheckCircle2 size={16} />
                  ) : (
                    <AlertCircle size={16} />
                  )}
                  分析模型{testResult.llmAvailable ? "可用" : "未找到"} ·
                  生图模型{testResult.imageAvailable ? "可用" : "未找到"}
                </span>
              )}
            </div>
          </section>
          <section className="panel settings-card">
            <div className="settings-card-heading">
              <div className="settings-icon orange-bg">
                <MapPin size={22} />
              </div>
              <div>
                <h2>目的地环境参考</h2>
                <p>优先免费实拍，找不到合适照片时自动想象当地。</p>
              </div>
              <span
                className={`badge ${environmentProvider === "commons" || settings.google.configured ? "mint" : "sand"}`}
              >
                {environmentProvider === "commons"
                  ? "免费实拍"
                  : settings.google.configured
                    ? "已配置"
                    : "待配置"}
              </span>
            </div>
            <label className="form-field">
              环境照片来源
              <select
                aria-label="环境照片来源"
                value={environmentProvider}
                onChange={(e) =>
                  setEnvironmentProvider(e.target.value as "commons" | "google")
                }
              >
                <option value="commons">
                  免费当地实拍 · Wikimedia Commons（推荐）
                </option>
                <option value="google">Google 街景 · 按请求计费</option>
              </select>
              <small>免费实拍无需申请密钥，可在出发前更换环境照片。</small>
            </label>
            <label className="form-field">
              Google Maps API Key（可选）
              <input
                type="password"
                autoComplete="new-password"
                value={googleKey}
                onChange={(e) => setGoogleKey(e.target.value)}
                placeholder={
                  settings.google.configured
                    ? "已保存，留空保持原密钥"
                    : "输入已启用 Street View Static API 的密钥"
                }
              />
              <small>
                在 Google Cloud 中启用 Street View Static API；启用 Geocoding
                API 可增强地点搜索。
              </small>
            </label>
            <div className="notice">
              <Globe2 size={17} />
              <span>
                默认使用 Commons 实拍照片，不消耗 Google
                街景额度。照片只参考环境，人物外貌仍来自你的照片库。
              </span>
            </div>
            <a
              className="settings-link"
              href="https://console.cloud.google.com/google/maps-apis/overview"
              target="_blank"
              rel="noreferrer"
            >
              打开 Google Maps Platform <ArrowUpRight size={14} />
            </a>
          </section>
          <button
            className="button primary save-settings"
            disabled={
              saving || !model.trim() || !imageModel.trim() || !baseUrl.trim()
            }
            onClick={() => void save()}
          >
            {saving ? (
              <LoaderCircle className="spin" size={17} />
            ) : (
              <Check size={17} />
            )}
            保存连接配置
          </button>
        </div>
        <aside className="panel settings-info">
          <div className="note-orbit">
            <Compass size={27} />
          </div>
          <h3>小小配置，走得更远。</h3>
          <dl>
            <dt>
              <Camera size={17} />
              照片库
            </dt>
            <dd>原始照片、文字索引和旅行相册保存在本机 data 目录。</dd>
            <dt>
              <KeyRound size={17} />
              服务密钥
            </dt>
            <dd>保存在 config/local.json。网页不会读取或显示已保存的密钥。</dd>
            <dt>
              <Shirt size={17} />
              衣着优先级
            </dt>
            <dd>
              手动指定优先；自动按天气与活动筛选，再由 AI
              结合目的地选衣。无合适原穿搭时保留外貌并重新搭配。
            </dd>
            <dt>
              <MapPin size={17} />
              场景优先级
            </dt>
            <dd>附近实拍 → AI 选图 → 无合适照片时自动想象。</dd>
          </dl>
          <p>
            地图数据 © OpenStreetMap
            <br />
            天气数据由{" "}
            <a href="https://open-meteo.com" target="_blank" rel="noreferrer">
              Open-Meteo
            </a>{" "}
            提供
            <br />
            灵感图片来自{" "}
            <a href="https://unsplash.com" target="_blank" rel="noreferrer">
              Unsplash
            </a>
          </p>
        </aside>
      </div>
    </>
  );
}
