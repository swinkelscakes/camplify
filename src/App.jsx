import { useState, useEffect } from "react";
import { getCamps, getKids, saveKid, updateKid, getEnrollments, saveEnrollment, updateEnrollment, deleteEnrollment, getBreaks, saveBreak, updateBreak, deleteBreak, updateCamp, saveCamp, getCircles, createCircle, joinCircleByCode, updateCircleMemberKid, updateParentName, getImportantDates, saveImportantDate, deleteImportantDate, getReviews, saveReview, deleteReview, updateCircle } from "./airtable";
import { useUser, useClerk, SignIn } from "@clerk/clerk-react";

const COLORS = {
  pine: "#2D5016",
  forest: "#3D6B1F",
  sage: "#7BAE5A",
  mint: "#C8E6A0",
  cream: "#FDF8EE",
  sand: "#F5E6C8",
  amber: "#E8A825",
  ember: "#D4621A",
  sky: "#4A90C4",
  lake: "#2C6E8A",
  blush: "#E8A0A0",
  canvas: "#FAF3E0",
};

const GOOGLE_FONT = `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');`;

const camps = [];

const kids = [];

const circles = []; // loaded from Airtable per user

// weeks array is computed dynamically from camp dates in the app
// See getWeeksFromCamps() below
const weeks = [];

const CAMP_COLORS = ["#3D6B1F","#2C6E8A","#9B59B6","#2C3E50","#E8A825","#D4621A","#E74C3C","#8E44AD","#1ABC9C","#E67E22"];

// Standardized initials for circle members: child first initial + parent last initial
const getMemberInitials = (childName, parentName) => {
  const c = (childName || "").trim();
  const p = (parentName || "").trim();
  const i1 = c[0]?.toUpperCase() || p[0]?.toUpperCase() || "?";
  const i2 = p.split(" ")[1]?.[0]?.toUpperCase() || "";
  return i1 + i2;
};

// Generate week columns dynamically from a pool of camps
const toLocalIso = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;

const getWeeksFromCamps = (campPool) => {
  const fmt = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const mondaySet = new Map();
  campPool.forEach(camp => {
    const start = camp.dateStart ? new Date(camp.dateStart + "T12:00:00") : null;
    const end = camp.dateEnd ? new Date(camp.dateEnd + "T12:00:00") : start;
    if (!start) return;
    const cur = new Date(start);
    const dow = cur.getDay();
    cur.setDate(cur.getDate() - (dow === 0 ? 6 : dow - 1));
    while (cur <= end) {
      const iso = toLocalIso(cur);
      if (!mondaySet.has(iso)) {
        const friday = new Date(cur);
        friday.setDate(friday.getDate() + 4);
        mondaySet.set(iso, {
          num: iso,
          dates: fmt(cur) + "–" + fmt(friday),
          monday: fmt(cur),
          dateStart: iso,
          dateEnd: toLocalIso(friday),
        });
      }
      cur.setDate(cur.getDate() + 7);
    }
  });
  return Array.from(mondaySet.values()).sort((a, b) => a.num.localeCompare(b.num));
};

// Check if a camp runs during a given week (by ISO monday date)
const campInWeek = (camp, weekIso) => {
  if (!camp.dateStart) return camp.week === weekIso;
  const wStart = weekIso;
  const d = new Date(weekIso + "T12:00:00"); d.setDate(d.getDate() + 6);
  const wEnd = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  // Swap if dateEnd is before dateStart (data entry error)
  const effectiveEnd = camp.dateEnd && camp.dateEnd >= camp.dateStart ? camp.dateEnd : camp.dateStart;
  return camp.dateStart <= wEnd && effectiveEnd >= wStart;
};
const STATUS_CONFIG = {
  enrolled: { label: "Enrolled", bg: "#5a8f35", light: "#eef5e8" },
  thinking:  { label: "Interested", bg: "#D97706", light: "#FEF3C7" },
  waitlist:  { label: "Waitlisted", bg: "#9CA3AF", light: "#F3F4F6" },
};
const StatusIcon = ({ s, size = 11, color = "currentColor" }) => {
  if (s === "enrolled") return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-label="Enrolled">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  );
  if (s === "thinking") return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-label="Thinking">
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><circle cx="12" cy="17" r="0.5" fill={color}/>
    </svg>
  );
  if (s === "waitlist") return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-label="Waitlisted">
      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
    </svg>
  );
  return null;
};

const AVATAR_SHOW = 3;
const STATUS_COLORS = {
  enrolled: "#3D6B1F",
  thinking: "#D97706",
  waitlist: "#9CA3AF",
};
const AvatarStack = ({ members }) => {
  if (!members || members.length === 0) return (
    <span style={{ fontSize: 11, color: "#D1D5DB", fontStyle: "italic" }}>–</span>
  );
  const visible = members.slice(0, AVATAR_SHOW);
  const overflow = members.length - AVATAR_SHOW;
  return (
    <div style={{ display: "flex", alignItems: "center" }}>
      {visible.map((m, i) => {
        const bg = STATUS_COLORS[m.status] || STATUS_COLORS.enrolled;
        const initials = m.isMyKid
          ? m.initials
          : getMemberInitials(m.child, m.name);
        return (
          <div key={m.id} title={(() => {
            const displayName = m.isMyKid
              ? m.name
              : m.child
                ? `${m.child} (${m.name || "parent"})`
                : (m.name || "Unknown");
            const statusLabel = m.status === "enrolled" ? "Enrolled" : m.status === "thinking" ? "Thinking about it" : m.status === "waitlist" ? "Waitlisted" : "Enrolled";
            return `${displayName} · ${statusLabel}`;
          })()} style={{
            width: 26, height: 26, borderRadius: "50%",
            background: bg,
            border: m.isMyKid ? "2.5px solid #1F2937" : "2px solid white",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 9, fontWeight: 800, color: "white",
            marginLeft: i > 0 ? -8 : 0,
            zIndex: AVATAR_SHOW - i,
            position: "relative", flexShrink: 0,
          }}>
            {initials}
          </div>
        );
      })}
      {overflow > 0 && (
        <div style={{
          width: 26, height: 26, borderRadius: "50%",
          background: "#E5E7EB", border: "2px solid white",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 9, fontWeight: 800, color: "#6B7280",
          marginLeft: -8, position: "relative", zIndex: 0, flexShrink: 0,
        }}>+{overflow}</div>
      )}
    </div>
  );
};

export default function App() {
  const { isSignedIn, isLoaded, user } = useUser();

  if (!isLoaded) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F9FAFB" }}>
      <div style={{ fontSize: 14, color: "#9CA3AF", fontFamily: "Inter, sans-serif" }}>Loading...</div>
    </div>
  );

  if (!isSignedIn) return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#F9FAFB", gap: 32 }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 36, fontWeight: 800, color: "#3D6B1F", fontFamily: "Inter, sans-serif", letterSpacing: "-1px", marginBottom: 8 }}>Camplify</div>
        <div style={{ fontSize: 15, color: "#6B7280", fontFamily: "Inter, sans-serif" }}>Plan your summer camps with your parent community</div>
      </div>
      <SignIn routing="hash" />
    </div>
  );

  return <Camplify userId={user.id} userName={user.firstName || user.fullName || "Parent"} userEmail={user.primaryEmailAddress?.emailAddress} />;
}

function Camplify({ userId, userName, userEmail }) {
  const [activeTab, setActiveTab] = useState("grid");
  const [airtableCamps, setAirtableCamps] = useState([]);
  const [airtableKids, setAirtableKids] = useState([]);
  const [airtableCircles, setAirtableCircles] = useState([]);
  const [enrollmentIds, setEnrollmentIds] = useState({});
  const [breakIds, setBreakIds] = useState({});
  const [importantDates, setImportantDates] = useState([]); // [{ id, kidId, label, dateStart, dateEnd }]
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      getCamps(),
      getKids(userId),
    ]).then(async ([campsData, kidsData]) => {
      setAirtableCamps(campsData);
      setAirtableKids(kidsData);
      setSelectedKids(new Set(kidsData.map(k => k.id)));
      setProfileKidId(kidsData[0]?.id || null);
      setImportKidId(kidsData[0]?.id || null);

      // Load circles independently so failure doesn't crash the app
      // Also refresh camps after circles load to catch camps added by friends
      getCircles(userId).then(async circlesData => {
        setAirtableCircles(circlesData);
        // If friends have camps we don't know about, reload camps
        const friendCampIds = new Set(circlesData.flatMap(c => c.members.flatMap(m => m.camps)));
        const knownCampIds = new Set(campsData.map(c => c.id));
        const hasUnknown = [...friendCampIds].some(id => !knownCampIds.has(id));
        if (hasUnknown) {
          getCamps().then(freshCamps => {
            setAirtableCamps(freshCamps);
            // Also reload reviews for newly discovered camps
            const allIds = freshCamps.map(c => c.id);
            if (allIds.length > 0) {
              getReviews(allIds).then(reviewsData => {
                const bycamp = {};
                reviewsData.forEach(r => { if (!bycamp[r.campId]) bycamp[r.campId] = []; bycamp[r.campId].push(r); });
                setCampReviews(bycamp);
              }).catch(e => console.warn('Reviews load failed:', e?.message));
            }
          }).catch(console.error);
        } else {
          // Still refresh reviews in case circle members added reviews since last load
          const allIds = campsData.map(c => c.id);
          if (allIds.length > 0) {
            getReviews(allIds).then(reviewsData => {
              const bycamp = {};
              reviewsData.forEach(r => { if (!bycamp[r.campId]) bycamp[r.campId] = []; bycamp[r.campId].push(r); });
              setCampReviews(bycamp);
            }).catch(e => console.warn('Reviews load failed:', e?.message));
          }
        }
      }).catch(err => console.warn('Circles failed to load:', err));
      setAirtableKids(kidsData);
      setSelectedKids(new Set(kidsData.map(k => k.id)));
      setProfileKidId(kidsData[0]?.id || null);
      setImportKidId(kidsData[0]?.id || null);

      // Populate kid profiles from Airtable data
      const profiles = {};
      kidsData.forEach(k => {
        profiles[k.id] = {
          age: k.age ? String(k.age) : "",
          interests: new Set(k.interests || []),
          zipcode: k.zipcode || "",
          visible: k.visible || false,
          bio: k.bio || "",
          bffs: new Set(k.bffs || []),
        };
      });
      setKidProfiles(profiles);

      // Load enrollments for these kids
      if (kidsData.length > 0) {
        const kidIdList = kidsData.map(k => k.id);
        const [enrollments, breaks, importantDatesData] = await Promise.all([
          getEnrollments(kidIdList),
          getBreaks(kidIdList),
          getImportantDates(kidIdList),
        ]);
        console.log('Loaded enrollments:', enrollments);
        console.log('Loaded breaks:', breaks);
        setImportantDates(importantDatesData);

        // Load reviews for all known camps
        const campIdList = campsData.map(c => c.id);
        if (campIdList.length > 0) {
          getReviews(campIdList).then(reviewsData => {
            const bycamp = {};
            reviewsData.forEach(r => {
              if (!bycamp[r.campId]) bycamp[r.campId] = [];
              bycamp[r.campId].push(r);
            });
            setCampReviews(bycamp);
          }).catch(e => console.warn('Reviews load failed (table may not exist yet):', e?.message));
        }
        const newStatus = {};
        const newIds = {};
        enrollments.forEach(e => {
          if (!e.kidId || !e.campId) return;
          if (!newStatus[e.campId]) newStatus[e.campId] = {};
          newStatus[e.campId][e.kidId] = {
            status: e.status,
            days: e.days,
            beforeCare: e.beforeCare,
            afterCare: e.afterCare,
            weeks: e.weeks || [],
          };
          newIds[e.campId + '-' + e.kidId] = e.id;
        });
        setCampStatus(newStatus);
        setEnrollmentIds(newIds);

        // Scroll overview to week before first future enrolled camp
        setTimeout(() => {
          const todayIso = new Date().toISOString().slice(0, 10);
          const allPool = [...campsData];
          const enrolledIds = new Set(Object.keys(newStatus));
          const futureCamps = allPool.filter(c =>
            enrolledIds.has(c.id) && c.dateStart && (c.dateEnd || c.dateStart) >= todayIso
          ).sort((a, b) => a.dateStart.localeCompare(b.dateStart));
          if (futureCamps.length === 0) return;
          const firstDate = futureCamps[0].dateStart;
          const d = new Date(firstDate + "T12:00:00");
          const dow = d.getDay();
          d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
          const todayMon = new Date(todayIso + "T12:00:00");
          const dow2 = todayMon.getDay();
          todayMon.setDate(todayMon.getDate() - (dow2 === 0 ? 6 : dow2 - 1));
          const diffWeeks = Math.round((d - todayMon) / (7 * 24 * 3600 * 1000));
          const targetIdx = Math.max(0, diffWeeks - 1);
          setMobileWeekOffset(targetIdx);
          setTimeout(() => {
            const el = document.getElementById("grid-scroll-container");
            if (el) el.scrollLeft = targetIdx * 156;
          }, 150);
        }, 50);

        // Restore kid breaks
        const newKidBreaks = {};
        const newBreakIds = {};
        breaks.forEach(b => {
          if (!b.kidId || !b.weekIso) return;
          if (!newKidBreaks[b.kidId]) newKidBreaks[b.kidId] = new Map();
          newKidBreaks[b.kidId].set(b.weekIso, b.label);
          newBreakIds[b.kidId + '-' + b.weekIso] = b.id;
        });
        setKidBreaks(newKidBreaks);
        setBreakIds(newBreakIds);
      }
      setLoading(false);
    }).catch(err => {
      console.error('Airtable error:', err);
      setLoading(false);
    });
  }, [userId]);
  const [selectedWeek, setSelectedWeek] = useState(3);
  const [selectedCircles, setSelectedCircles] = useState(new Set()); // empty = all
  const toggleCircle = (id) => setSelectedCircles(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const [showAddCircle, setShowAddCircle] = useState(false);
  const [editingCircleId, setEditingCircleId] = useState(null);
  const [editingCircleName, setEditingCircleName] = useState("");
  const [newCircleName, setNewCircleName] = useState("");
  const [expandedMember, setExpandedMember] = useState(null);
  const [selectedKids, setSelectedKids] = useState(new Set());
  const [inviteCircleId, setInviteCircleId] = useState(null);
  // Enrollment details modal (days + care selection when adding kid to camp)
  const [enrollModal, setEnrollModal] = useState(null); // { campId, kidId, status }
  const [enrollDays, setEnrollDays] = useState([]);
  const [enrollWeeks, setEnrollWeeks] = useState([]);
  const [enrollBeforeCare, setEnrollBeforeCare] = useState(false);
  const [enrollAfterCare, setEnrollAfterCare] = useState(false);
  const openEnrollModal = (campId, kidId, status, campDays) => {
    const camp = [...camps, ...airtableCamps, ...dynamicCamps].find(c => c.id === campId);
    setEnrollModal({ campId, kidId, status });
    const daysToUse = (camp?.days?.length > 0 ? camp.days : null) || campDays || ["M","T","W","Th","F"];
    setEnrollDays(daysToUse);
    // For single-week camps auto-select the week; for multi-week start empty so parent chooses
    if (camp?.dateStart) {
      const getMon = (ds) => { const d = new Date(ds + "T12:00:00"); const dow = d.getDay(); d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1)); return d.toISOString().slice(0, 10); };
      const weeks = [];
      const cur = new Date(getMon(camp.dateStart) + "T12:00:00");
      const endD = new Date((camp.dateEnd || camp.dateStart) + "T12:00:00");
      while (cur <= endD) { weeks.push(cur.toISOString().slice(0, 10)); cur.setDate(cur.getDate() + 7); }
      setEnrollWeeks(weeks.length === 1 ? weeks : []);
    } else {
      setEnrollWeeks([]);
    }
    setEnrollBeforeCare(false);
    setEnrollAfterCare(false);
  };
  const confirmEnroll = () => {
    if (!enrollModal) return;
    setEnrollmentDetails(enrollModal.campId, enrollModal.kidId, {
      status: enrollModal.status,
      days: enrollDays,
      weeks: enrollWeeks,
      beforeCare: enrollBeforeCare,
      afterCare: enrollAfterCare,
    });
    setEnrollModal(null);
  };

  // breaks: Set of keys like "week-3" or "day-2026-07-07"
  const [breaks, setBreaks] = useState(new Set());
  const [kidBreaks, setKidBreaks] = useState({});
  const setKidBreak = async (kidId, weekIso, label) => {
    setKidBreaks(prev => {
      const next = { ...prev };
      const m = new Map(prev[kidId] || []);
      if (m.has(weekIso) && label === undefined) {
        m.delete(weekIso);
      } else {
        m.set(weekIso, label || "Break");
      }
      next[kidId] = m;
      return next;
    });
    const key = kidId + '-' + weekIso;
    const existingId = breakIds[key];
    if (label === undefined) {
      if (existingId) {
        await deleteBreak(existingId).catch(console.error);
        setBreakIds(prev => { const next = { ...prev }; delete next[key]; return next; });
      }
    } else if (existingId) {
      await updateBreak(existingId, label).catch(console.error);
    } else {
      const newId = await saveBreak(kidId, weekIso, label).catch(console.error);
      if (newId) setBreakIds(prev => ({ ...prev, [key]: newId }));
    }
  };
  const toggleKidWeekBreak = (kidId, weekNum) => setKidBreak(kidId, weekNum, undefined);
  const [openBreakPicker, setOpenBreakPicker] = useState(null); // weekNum or null
  const [weekAddCamp, setWeekAddCamp] = useState(null);
  const [weekAddName, setWeekAddName] = useState("");
  const [emailCopied, setEmailCopied] = useState(false);
  const toggleWeekBreak = (weekIso) => {
    setBreaks(prev => {
      const next = new Set(prev);
      next.has(weekIso) ? next.delete(weekIso) : next.add(weekIso);
      return next;
    });
  };
  const toggleDayBreak = (dateStr) => {
    setBreaks(prev => {
      const next = new Set(prev);
      next.has(dateStr) ? next.delete(dateStr) : next.add(dateStr);
      return next;
    });
  };
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteSent, setInviteSent] = useState(false);
  const [expandedWeeks, setExpandedWeeks] = useState(new Set());
  const toggleWeekExpanded = (weekNum) => {
    setExpandedWeeks(prev => {
      const next = new Set(prev);
      next.has(weekNum) ? next.delete(weekNum) : next.add(weekNum);
      return next;
    });
  };
  // campStatus: { [campId]: { [kidId]: "enrolled"|"thinking"|"waitlist" } }
  const [campStatus, setCampStatus] = useState({});
  // Helper: get just the status string for a kid at a camp
  const getKidStatus = (campId, kidId) => {
    const entry = campStatus[campId]?.[kidId];
    if (!entry) return null;
    return typeof entry === "string" ? entry : entry.status;
  };
  // Helper: get enrollment details
  const getKidEnrollment = (campId, kidId) => {
    const entry = campStatus[campId]?.[kidId];
    if (!entry) return null;
    if (typeof entry === "string") return { status: entry, days: null, beforeCare: false, afterCare: false };
    return entry;
  };
  const [openPicker, setOpenPicker] = useState(null);
  // openPicker: { campId, kidId, campName, kidName, currentStatus } | null
  const openStatusPicker = (campId, kidId, campName, kidName, currentStatus) =>
    setOpenPicker({ campId, kidId, campName, kidName, currentStatus });
  const closeStatusPicker = () => setOpenPicker(null);
  const [calMonth, setCalMonth] = useState(5); // 0-indexed, 5 = June
  const [calYear, setCalYear] = useState(2026);
  const [specialDates, setSpecialDates] = useState([
    { id: 1, date: "2026-06-05", label: "Last Day of School", color: "#E8A825" },
    { id: 2, date: "2026-07-04", label: "Fourth of July", color: "#D4621A" },
  ]);
  const [showAddDate, setShowAddDate] = useState(false);
  const [newDateValue, setNewDateValue] = useState("");
  const nextDateId = () => Date.now();
  const [addMode, setAddMode] = useState("manual"); // "manual" | "email"
  const [duplicateMatch, setDuplicateMatch] = useState(null); // matched camp if duplicate found
  const [nameSuggestions, setNameSuggestions] = useState([]); // friend camps matching typed name
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [manualForm, setManualForm] = useState({
    name: "", dateStart: "", dateEnd: "", location: "", address: "",
    timeStart: "", timeEnd: "", beforeCareStart: "", beforeCareEnd: "", beforeCareCost: "", afterCareStart: "", afterCareEnd: "", afterCareCost: "", url: "", discountCode: "", notes: "", days: [], ageMin: "", ageMax: "", gradeMin: "", gradeMax: "", ageOrGrade: "age", cost: "", campType: [],
  });
  const updateForm = (field, val) => {
    setManualForm(prev => ({ ...prev, [field]: val }));
    if (field === "name") {
      setDuplicateMatch(null);
      const query = val.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
      if (query.length >= 2) {
        const allCampPool = [...camps, ...airtableCamps, ...dynamicCamps];
        // Find camps that friends are in that match the query
        const friendCampIds = new Set(
          liveCircles.flatMap(c => c.members.flatMap(m => m.camps))
        );
        const suggestions = allCampPool.filter(c => {
          const cn = c.name.toLowerCase().replace(/[^a-z0-9]/g, "");
          return friendCampIds.has(c.id) && (cn.includes(query) || query.includes(cn.slice(0, query.length)));
        });
        setNameSuggestions(suggestions);
        setShowSuggestions(suggestions.length > 0);
      } else {
        setNameSuggestions([]);
        setShowSuggestions(false);
      }
    }
  };
  const toggleFormDay = (d) => setManualForm(prev => ({
    ...prev,
    days: prev.days.includes(d) ? prev.days.filter(x => x !== d) : [...prev.days, d]
  }));

  const findDuplicate = (name) => {
    if (!name.trim()) return null;
    const normalize = s => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const allCampPool = [...camps, ...airtableCamps, ...dynamicCamps];
    const input = normalize(name);
    // Check exact or close match (contains or starts with)
    return allCampPool.find(c => {
      const cn = normalize(c.name);
      return cn === input || cn.includes(input) || input.includes(cn);
    }) || null;
  };

  const submitManualForm = async () => {
    if (!manualForm.name.trim()) return;
    const dup = findDuplicate(manualForm.name);
    if (dup && !duplicateMatch) {
      setDuplicateMatch(dup);
      return;
    }
    setDuplicateMatch(null);
    const id = nextCampId();
    const color = CAMP_COLORS[dynamicCamps.length % CAMP_COLORS.length];
    // Compute week ISO dates from dateStart/dateEnd dynamically
    const ds = manualForm.dateStart;
    const de = manualForm.dateEnd || ds;
    const getMon = (dateStr) => {
      const d = new Date(dateStr + "T12:00:00");
      const dow = d.getDay();
      d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
      return d.toISOString().slice(0, 10);
    };
    const computedWeekRange = [];
    if (ds) {
      const cur = new Date(getMon(ds) + "T12:00:00");
      const endD = new Date((de || ds) + "T12:00:00");
      while (cur <= endD) {
        computedWeekRange.push(cur.toISOString().slice(0, 10));
        cur.setDate(cur.getDate() + 7);
      }
    }
    const week = computedWeekRange[0] || getMon(new Date().toISOString().slice(0,10));
    const weekRange = computedWeekRange.length > 0 ? computedWeekRange : [week];
    const formatDate = (iso) => {
      if (!iso) return "";
      const d = new Date(iso + "T12:00:00");
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    };
    const dates = manualForm.dateStart && manualForm.dateEnd
      ? `${formatDate(manualForm.dateStart)}–${formatDate(manualForm.dateEnd)}`
      : manualForm.dateStart ? formatDate(manualForm.dateStart) : "";
    const newCamp = {
      id, color, emoji: "",
      name: manualForm.name,
      url: manualForm.url || "",
      dates,
      location: manualForm.location,
      address: manualForm.address,
      hours: manualForm.timeStart && manualForm.timeEnd ? `${manualForm.timeStart} – ${manualForm.timeEnd}` : "",
      beforeCare: manualForm.beforeCareStart && manualForm.beforeCareEnd ? `${manualForm.beforeCareStart} – ${manualForm.beforeCareEnd}` : "",
      beforeCareCost: manualForm.beforeCareCost || null,
      afterCare: manualForm.afterCareStart && manualForm.afterCareEnd ? `${manualForm.afterCareStart} – ${manualForm.afterCareEnd}` : "",
      afterCareCost: manualForm.afterCareCost || null,
      discountCode: manualForm.discountCode,
      notes: manualForm.notes,
      days: manualForm.days.length ? manualForm.days : ["M","T","W","Th","F"],
      week,
      weekRange,
      dateStart: manualForm.dateStart,
      dateEnd: manualForm.dateEnd,
      ageMin: manualForm.ageOrGrade === "age" && manualForm.ageMin ? parseInt(manualForm.ageMin) : null,
      ageMax: manualForm.ageOrGrade === "age" && manualForm.ageMax ? parseInt(manualForm.ageMax) : null,
      gradeMin: manualForm.ageOrGrade === "grade" ? manualForm.gradeMin : null,
      gradeMax: manualForm.ageOrGrade === "grade" ? manualForm.gradeMax : null,
      cost: manualForm.cost || null,
      campType: Array.isArray(manualForm.campType) ? manualForm.campType : (manualForm.campType ? [manualForm.campType] : []),
    };
    setDynamicCamps(prev => [...prev, newCamp]);
    setManualForm({ name: "", dateStart: "", dateEnd: "", location: "", address: "", timeStart: "", timeEnd: "", beforeCareStart: "", beforeCareEnd: "", beforeCareCost: "", afterCareStart: "", afterCareEnd: "", afterCareCost: "", url: "", discountCode: "", notes: "", days: [], ageMin: "", ageMax: "", gradeMin: "", gradeMax: "", ageOrGrade: "age", cost: "", campType: "" });
    setImportDone(true);
    // Save to Airtable and await real ID before redirecting
    try {
      const formSnapshot = { ...manualForm };
      const savedId = await saveCamp(userId, formSnapshot);
      if (savedId) {
        // Remove from dynamicCamps (temp) and add to airtableCamps (permanent) to avoid duplicate
        setDynamicCamps(prev => prev.filter(c => c.id !== id));
        setAirtableCamps(prev => [...prev, { ...newCamp, id: savedId, userId }]);
        // Update any enrollments that used the temp id
        setCampStatus(prev => {
          if (!prev[id]) return prev;
          const next = { ...prev };
          next[savedId] = next[id];
          delete next[id];
          return next;
        });
        setEnrollmentIds(prev => {
          const next = { ...prev };
          Object.keys(next).forEach(k => {
            if (k.startsWith(id + '-')) {
              next[k.replace(id + '-', savedId + '-')] = next[k];
              delete next[k];
            }
          });
          return next;
        });
      }
    } catch(e) {
      console.error('saveCamp error:', e);
    }
    setTimeout(() => { setImportDone(false); setActiveTab("camps"); }, 1800);
  };
  const [emailText, setEmailText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parsedCamp, setParsedCamp] = useState(null);
  const [parseError, setParseError] = useState("");
  const [importKidId, setImportKidId] = useState(null);
  const [importStatus, setImportStatus] = useState("enrolled");
  const [importDone, setImportDone] = useState(false);
  const [dynamicCamps, setDynamicCamps] = useState([]);
  const [dynamicCampStatus, setDynamicCampStatus] = useState({});

  // Compute week columns dynamically from all camps
  const computedWeeks = getWeeksFromCamps([...camps, ...airtableCamps, ...dynamicCamps]);

  // Get today's Monday ISO string (local time)
  const todayMonday = (() => {
    const d = new Date();
    const dow = d.getDay();
    d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  })();

  // Generate all weeks from today through the last camp week
  const visibleWeeks = (() => {
    const allCampPool = [...camps, ...airtableCamps, ...dynamicCamps];
    // Always show at least 52 weeks from today, extend further if camps go longer
    let latestDate = new Date(todayMonday + "T12:00:00");
    latestDate.setDate(latestDate.getDate() + 7 * 52);
    allCampPool.forEach(c => {
      const end = c.dateEnd || c.dateStart;
      if (end) {
        const d = new Date(end + "T12:00:00");
        if (d > latestDate) latestDate = d;
      }
    });
    const toLocalIso = (d) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    };
    // Generate every week from today through latest date
    const weeks = [];
    const fmt = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const cur = new Date(todayMonday + "T12:00:00");
    while (cur <= latestDate) {
      const iso = toLocalIso(cur);
      const fri = new Date(cur); fri.setDate(fri.getDate() + 4);
      weeks.push({ num: iso, dates: fmt(cur) + "–" + fmt(fri) });
      cur.setDate(cur.getDate() + 7);
    }
    return weeks;
  })();

  // US federal holidays + common school holidays — weekday dates for 2026
  const US_HOLIDAYS = {
    "2026-01-01": "New Year's Day",
    "2026-01-19": "MLK Day",
    "2026-02-16": "Presidents' Day",
    "2026-05-25": "Memorial Day",
    "2026-06-19": "Juneteenth",
    "2026-07-03": "Independence Day (observed)", // July 4 is Saturday, observed Friday
    "2026-09-07": "Labor Day",
    "2026-10-12": "Columbus Day",
    "2026-11-11": "Veterans Day",
    "2026-11-26": "Thanksgiving",
    "2026-11-27": "Day after Thanksgiving",
    "2026-12-24": "Christmas Eve",
    "2026-12-25": "Christmas Day",
    "2026-12-31": "New Year's Eve",
  };

  // Get holidays that fall in a given week
  const getHolidaysInWeek = (weekIso) => {
    const start = new Date(weekIso + "T00:00:00");
    const end = new Date(start); end.setDate(end.getDate() + 6);
    return Object.entries(US_HOLIDAYS)
      .filter(([date]) => { const d = new Date(date + "T12:00:00"); return d >= start && d <= end; })
      .map(([date, name]) => ({ date, name }));
  };

  // Use airtableKids as the source of truth, fall back to empty array
  const kids = airtableKids;

  // Use airtableCircles as the source of truth
  const liveCircles = airtableCircles;

  const nextCampId = () => 1000 + dynamicCamps.length;

  const parseEmail = async () => {
    if (!emailText.trim()) return;
    setParsing(true);
    setParseError("");
    setParsedCamp(null);
    try {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: `You extract summer camp registration details from forwarded confirmation emails.
Return ONLY a valid JSON object with these fields (no markdown, no explanation):
{
  "name": "Camp name",
  "location": "Neighborhood or city",
  "address": "Full street address if found, else empty string",
  "dates": "e.g. Jul 14–18",
  "hours": "e.g. 9:00 AM – 3:00 PM",
  "days": ["M","T","W","Th","F"],
  "url": "camp website url if found, else empty string",
  "week": 1
}
For "week": map dates to 1=Jun 22–26, 2=Jun 29–Jul 3, 3=Jul 6–10, 4=Jul 13–17, 5=Jul 20–24, or best guess.
For "days": infer from the dates or any schedule info. If full week, use all 5. Return ONLY the JSON.`,
          messages: [{ role: "user", content: emailText }]
        })
      });
      const data = await resp.json();
      const raw = data.content?.find(b => b.type === "text")?.text || "";
      const clean = raw.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);
      setParsedCamp(parsed);
    } catch (e) {
      setParseError("Couldn't parse the email. Try pasting the full email text.");
    }
    setParsing(false);
  };

  const confirmImport = () => {
    if (!parsedCamp) return;
    const id = nextCampId();
    const color = CAMP_COLORS[dynamicCamps.length % CAMP_COLORS.length];
    const newCamp = { ...parsedCamp, id, color, emoji: "" };
    setDynamicCamps(prev => [...prev, newCamp]);
    setDynamicCampStatus(prev => ({
      ...prev,
      [id]: { [importKidId]: importStatus }
    }));
    setCampStatus(prev => ({
      ...prev,
      [id]: { [importKidId]: importStatus }
    }));
    setImportDone(true);
    setTimeout(() => {
      setImportDone(false);
      setEmailText("");
      setParsedCamp(null);
      setActiveTab("weekly");
    }, 1800);
  };
  const [sharecamp, setShareCamp] = useState(null); // campId being shared
  const [shareCopied, setShareCopied] = useState(false);
  const [gridPopover, setGridPopover] = useState(null);
  const [gridAddCell, setGridAddCell] = useState(null); // { kidId, weekNum, x, y }
  const [breakLabelInput, setBreakLabelInput] = useState("");
  const [addingKid, setAddingKid] = useState(false);
  const [newKidName, setNewKidName] = useState("");
  const [newKidLastInitial, setNewKidLastInitial] = useState("");
  const [savingKid, setSavingKid] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [joinError, setJoinError] = useState("");
  const [joinLoading, setJoinLoading] = useState(false);
  const [circleKidIds, setCircleKidIds] = useState(new Set());
  const [parentName, setParentName] = useState(userName || "");
  const [mobileWeekOffset, setMobileWeekOffset] = useState(0);
  const [campSearch, setCampSearch] = useState("");
  const [addingDate, setAddingDate] = useState(false);
  const [newDateLabel, setNewDateLabel] = useState("");
  const [newDateStart, setNewDateStart] = useState("");
  const [newDateEnd, setNewDateEnd] = useState("");
  const [savingDate, setSavingDate] = useState(false); // kids to add when creating/joining
  const [friendProfilePopover, setFriendProfilePopover] = useState(null); // { person, x, y }
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [campTypeFilter, setCampTypeFilter] = useState(new Set());
  const [campSort, setCampSort] = useState("date");
  const [focusedCampId, setFocusedCampId] = useState(null);
  const [expandedCampId, setExpandedCampId] = useState(null);
  const [campStatusPicker, setCampStatusPicker] = useState(null); // { campId, kidId }
  const [editCampId, setEditCampId] = useState(null); // camp being edited
  const [editForm, setEditForm] = useState(null); // form state for editing
  const [campReviews, setCampReviews] = useState({});
  const [reviewDraft, setReviewDraft] = useState({}); // { [campId]: { rating, text } }
  const [showReviewForm, setShowReviewForm] = useState(null); // campId
  const [kidProfiles, setKidProfiles] = useState({});
  const [profileKidId, setProfileKidId] = useState(null);
  const updateKidProfile = (kidId, field, val) => {
    setKidProfiles(prev => ({ ...prev, [kidId]: { ...prev[kidId], [field]: val } }));
    if (field === "interests") {
      // Save immediately for interests - each click is discrete
      const interests = val instanceof Set ? Array.from(val) : val;
      updateKid(kidId, { interests }).catch(console.error);
    } else {
      // Debounce text fields
      clearTimeout(window.__kidProfileTimer);
      window.__kidProfileTimer = setTimeout(() => {
        const toSave = {};
        if (field === "age") toSave.age = val ? Number(val) : null;
        else toSave[field] = val;
        updateKid(kidId, toSave).catch(console.error);
      }, 800);
    }
  };

  const toggleBff = (kidId, memberId) => {
    setKidProfiles(prev => {
      const profile = prev[kidId] || {};
      const bffs = new Set(profile.bffs || []);
      bffs.has(memberId) ? bffs.delete(memberId) : bffs.add(memberId);
      const updated = { ...prev, [kidId]: { ...profile, bffs } };
      // Persist to Airtable
      updateKid(kidId, { bffs: Array.from(bffs) }).catch(console.error);
      return updated;
    });
  };

  // Helper: get BFF userIds for a given kid
  const getBffs = (kidId) => kidProfiles[kidId]?.bffs || new Set();

  const updateKidName = (kidId, name, initials) => {
    setAirtableKids(prev => prev.map(k => k.id === kidId ? { ...k, name, initials } : k));
    clearTimeout(window.__kidNameTimer);
    window.__kidNameTimer = setTimeout(() => {
      updateKid(kidId, { name, initials }).catch(console.error);
    }, 800);
  };

  const handleNativeShare = async (camp) => {
    const text = `Check out ${camp.name} - ${camp.dates} at ${camp.location}!`;
    if (navigator.share) {
      try { await navigator.share({ title: camp.name, text }); } catch {}
    } else {
      await navigator.clipboard.writeText(text);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    }
  };

  const getShareLinks = (camp) => {
    const text = encodeURIComponent(`Check out ${camp.name} - ${camp.dates} at ${camp.location}!`);
    return {
      sms: `sms:?body=${text}`,
      whatsapp: `https://wa.me/?text=${text}`,
      email: `mailto:?subject=${encodeURIComponent(camp.name)}&body=${text}`,
    };
  };

  const setStatus = async (campId, kidId, status) => {
    setCampStatus(prev => {
      const existing = prev[campId]?.[kidId];
      const details = existing && typeof existing === "object" ? existing : { days: null, beforeCare: false, afterCare: false };
      return { ...prev, [campId]: { ...(prev[campId] || {}), [kidId]: { ...details, status } } };
    });
    const key = campId + '-' + kidId;
    const existingId = enrollmentIds[key];
    if (existingId) {
      const current = campStatus[campId]?.[kidId];
      const days = current?.days || [];
      const beforeCare = current?.beforeCare || false;
      const afterCare = current?.afterCare || false;
      const weeks = current?.weeks || [];
      await updateEnrollment(existingId, status, days, beforeCare, afterCare, weeks).catch(console.error);
    } else {
      const newId = await saveEnrollment(kidId, campId, status, [], false, false, []).catch(console.error);
      if (newId) setEnrollmentIds(prev => ({ ...prev, [key]: newId }));
    }
  };

  const setEnrollmentDetails = async (campId, kidId, details) => {
    setCampStatus(prev => {
      const existing = prev[campId]?.[kidId];
      const base = existing && typeof existing === "object" ? existing : { status: existing || "enrolled" };
      return { ...prev, [campId]: { ...(prev[campId] || {}), [kidId]: { ...base, ...details } } };
    });
    const key = campId + '-' + kidId;
    const existingId = enrollmentIds[key];
    const status = details.status || campStatus[campId]?.[kidId]?.status || "enrolled";
    const days = details.days || [];
    const beforeCare = details.beforeCare || false;
    const afterCare = details.afterCare || false;
    const weeks = details.weeks || [];
    if (existingId) {
      await updateEnrollment(existingId, status, days, beforeCare, afterCare, weeks).catch(console.error);
    } else {
      const newId = await saveEnrollment(kidId, campId, status, days, beforeCare, afterCare, weeks).catch(console.error);
      if (newId) setEnrollmentIds(prev => ({ ...prev, [key]: newId }));
    }
  };

  const removeStatus = async (campId, kidId) => {
    setCampStatus(prev => {
      const next = { ...prev };
      if (next[campId]) {
        next[campId] = { ...next[campId] };
        delete next[campId][kidId];
      }
      return next;
    });
    // Delete from Airtable
    const key = campId + '-' + kidId;
    const existingId = enrollmentIds[key];
    if (existingId) {
      await deleteEnrollment(existingId).catch(console.error);
      setEnrollmentIds(prev => { const next = { ...prev }; delete next[key]; return next; });
    }
  };

  const toggleKid = (id) => {
    setSelectedKids(prev => {
      const next = new Set(prev);
      if (next.has(id)) { if (next.size > 1) next.delete(id); }
      else next.add(id);
      return next;
    });
  };

  const weekCamps = camps.filter((c) => c.week === selectedWeek);

  const getKidCampsForWeek = (week) =>
    kids.flatMap((kid) =>
      kid.camps
        .map((cid) => camps.find((c) => c.id === cid))
        .filter((c) => c && c.week === week)
        .map((c) => ({ ...c, kidName: kid.name, kidAvatar: kid.avatar, kidInitials: kid.initials }))
    );

  const getFriendCampsForWeek = (week, circleIds) => {
    const members = circleIds && circleIds.size > 0
      ? liveCircles.filter(c => circleIds.has(c.id)).flatMap(c => c.members)
      : liveCircles.flatMap((c) => c.members);
    return members.flatMap((m) =>
      m.camps
        .map((cid) => camps.find((c) => c.id === cid))
        .filter((c) => c && c.week === week)
        .map((c) => {
          return { ...c, friendName: m.child, parentName: m.name,
            friendInitials: getMemberInitials(m.child, m.name), childInitials: getMemberInitials(m.child, m.name) };
        })
    );
  };

  const myWeekCamps = getKidCampsForWeek(selectedWeek);
  const friendWeekCamps = getFriendCampsForWeek(selectedWeek, selectedCircles);

  // dedupe by camp id, collect friend objects
  const friendCampMap = {};
  friendWeekCamps.forEach((fc) => {
    if (!friendCampMap[fc.id]) friendCampMap[fc.id] = { ...fc, friends: [] };
    if (!friendCampMap[fc.id].friends.find(f => f.name === fc.friendName))
      friendCampMap[fc.id].friends.push({ name: fc.friendName, initials: fc.friendInitials });
  });

  return (
    <>
      <style>{`
        ${GOOGLE_FONT}
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        :root {
          --indigo: #4F46E5; --indigo-dark: #4338CA; --indigo-light: #EEF2FF;
          --purple: #7C3AED; --green: #5a8f35; --green-light: #F0FDF4;
          --amber: #D97706; --red: #DC2626; --sky: #0284C7;
          --gray-50: #F9FAFB; --gray-100: #F3F4F6; --gray-200: #E5E7EB;
          --gray-300: #D1D5DB; --gray-400: #9CA3AF; --gray-500: #6B7280;
          --gray-600: #4B5563; --gray-700: #374151; --gray-800: #1F2937; --gray-900: #111827;
          --white: #FFFFFF; --shadow-sm: 0 1px 2px rgba(0,0,0,0.05); --shadow: 0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06);
          --radius-sm: 6px; --radius: 8px; --radius-lg: 12px; --radius-xl: 16px;
        }
        body { background: var(--gray-50); font-family: 'Inter', system-ui, sans-serif; color: var(--gray-900); -webkit-font-smoothing: antialiased; }
        .app { min-height: 100vh; }

        /* ── HEADER ── */
        .header {
          background: var(--white); border-bottom: 1px solid var(--gray-200);
          padding: 0 16px; position: sticky; top: 0; z-index: 100;
        }
        .header-inner {
          max-width: 680px; margin: 0 auto;
          display: flex; align-items: center; justify-content: space-between;
          padding: 14px 0;
        }
        .logo {
          font-size: 26px; font-weight: 800; color: #3D6B1F;
          display: flex; align-items: center; gap: 8px; letter-spacing: -0.5px;
          font-family: 'Inter', sans-serif;
        }
        .logo-dot { display: none; }
        .nav { display: flex; gap: 1px; background: var(--gray-100); border-radius: var(--radius); padding: 3px; }
        .nav-btn {
          background: none; border: none; cursor: pointer;
          font-family: 'Inter', sans-serif; font-weight: 600; font-size: 13px;
          color: var(--gray-500); padding: 6px 14px; border-radius: var(--radius-sm);
          transition: all 0.15s;
        }
        .nav-btn:hover { color: var(--gray-900); }
        .nav-btn.active { background: var(--white); color: var(--gray-900); box-shadow: var(--shadow-sm); }
        .nav-add-camp-btn {
          background: #3D6B1F; border: none; cursor: pointer;
          font-family: 'Inter', sans-serif; font-weight: 600; font-size: 13px;
          color: white; padding: 7px 14px; border-radius: var(--radius);
          transition: all 0.15s; margin-left: 10px;
        }
        .nav-add-camp-btn:hover { background: #2D5016; }

        /* ── MAIN ── */
        .main { max-width: 680px; margin: 0 auto; padding: 20px 16px 80px; }

        .section-title { font-size: 22px; font-weight: 700; color: var(--gray-900); margin-bottom: 4px; }
        .section-sub { font-size: 13px; color: var(--gray-500); margin-bottom: 20px; }

        /* ── WEEK SELECTOR ── */
        .week-selector { display: flex; gap: 6px; margin-bottom: 20px; flex-wrap: wrap; }
        .week-btn {
          border: 1px solid var(--gray-200); background: var(--white); cursor: pointer;
          border-radius: var(--radius); padding: 7px 14px;
          font-family: 'Inter', sans-serif; font-weight: 500; font-size: 12.5px;
          color: var(--gray-600); transition: all 0.15s;
        }
        .week-btn:hover { border-color: var(--indigo); color: var(--indigo); }
        .week-btn.active { background: var(--indigo); border-color: var(--indigo); color: white; font-weight: 600; }
        .week-dates { font-weight: 400; font-size: 10.5px; opacity: 0.8; display: block; margin-top: 1px; }

        /* ── FILTER BAR ── */
        .filter-bar {
          display: flex; flex-direction: column; gap: 8px;
          margin-bottom: 20px; background: var(--white); border-radius: var(--radius-xl);
          padding: 12px 16px; box-shadow: var(--shadow); border: 1px solid var(--gray-200);
        }
        .filter-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
        .circle-filter-label { font-size: 11.5px; font-weight: 600; color: var(--gray-500); margin-right: 2px; }

        .sibling-toggle {
          display: flex; align-items: center; gap: 6px;
          border: 1.5px solid; border-radius: 7px; padding: 4px 12px 4px 5px;
          font-family: 'Inter', sans-serif; font-weight: 600; font-size: 12.5px;
          cursor: pointer; transition: all 0.15s;
        }
        .sibling-toggle:hover { box-shadow: var(--shadow); }
        .sibling-initials-bubble {
          width: 20px; height: 20px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          font-size: 8px; font-weight: 700; flex-shrink: 0;
        }

        .circle-pill {
          border: 1px solid var(--gray-200); background: var(--white); cursor: pointer;
          border-radius: 7px; padding: 4px 12px;
          font-family: 'Inter', sans-serif; font-weight: 500; font-size: 12px;
          color: var(--gray-600); transition: all 0.15s;
        }
        .circle-pill:hover { border-color: var(--gray-300); }
        .circle-pill.active { color: white; font-weight: 600; border-color: transparent; background: #3D6B1F; }

        /* ── WEEK BLOCK ── */
        .week-block { margin-bottom: 16px; }
        .week-block.break-week { opacity: 0.45; }
        .week-block.break-week .week-block-header { opacity: 1; }

        .week-block-header {
          border-radius: var(--radius-lg) var(--radius-lg) 0 0;
          background: #4a7c28;
          padding: 12px 16px; display: flex; align-items: center; gap: 10px;
        }
        .week-block-label { font-size: 19px; font-weight: 700; color: white; letter-spacing: -0.3px; }
        .week-block-sublabel { font-size: 11px; font-weight: 600; color: rgba(255,255,255,0.65); text-transform: uppercase; letter-spacing: 0.5px; }

        .week-block-inner { background: var(--white); border-radius: 0 0 var(--radius-lg) var(--radius-lg); border: 1px solid var(--gray-200); border-top: none; padding: 12px; }

        .density-badge {
          display: flex; align-items: center; gap: 4px;
          background: rgba(255,255,255,0.2); border-radius: 7px;
          padding: 3px 10px 3px 6px; margin-left: auto;
          font-family: 'Inter', sans-serif; font-size: 11.5px; font-weight: 600;
          color: white;
        }
        .density-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; background: white; }
        .density-count { color: white; font-weight: 700; }

        .mark-break-btn {
          background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.3); border-radius: 7px;
          padding: 4px 10px; font-family: 'Inter', sans-serif;
          font-size: 11px; font-weight: 600; color: rgba(255,255,255,0.85); cursor: pointer;
          transition: all 0.15s; white-space: nowrap; margin-left: auto;
        }
        .mark-break-btn:hover { background: rgba(255,255,255,0.25); color: white; }
        .break-badge {
          display: flex; align-items: center; gap: 5px;
          background: rgba(255,255,255,0.2); color: white; border-radius: 7px;
          padding: 4px 8px 4px 10px; font-size: 11px; font-weight: 600;
          cursor: pointer; white-space: nowrap; margin-left: auto; border: 1px solid rgba(255,255,255,0.3);
        }
        .break-remove {
          background: rgba(255,255,255,0.2); border: none; color: white;
          border-radius: 50%; width: 14px; height: 14px; font-size: 10px;
          cursor: pointer; display: flex; align-items: center; justify-content: center; line-height: 1; padding: 0;
        }
        .break-picker {
          position: absolute; top: calc(100% + 5px); right: 0; z-index: 300;
          background: white; border-radius: var(--radius-lg); border: 1px solid var(--gray-200);
          box-shadow: 0 10px 25px rgba(0,0,0,0.12); padding: 6px; min-width: 180px;
          display: flex; flex-direction: column; gap: 1px;
        }
        .break-picker-title {
          font-size: 10px; font-weight: 700; color: var(--gray-400); letter-spacing: 0.8px;
          text-transform: uppercase; padding: 2px 6px 6px; border-bottom: 1px solid var(--gray-100); margin-bottom: 2px;
        }
        .break-option {
          display: flex; align-items: center; justify-content: space-between;
          background: none; border: none; border-radius: var(--radius-sm); padding: 7px 8px;
          font-family: 'Inter', sans-serif; font-size: 13px; font-weight: 400;
          color: var(--gray-700); cursor: pointer; text-align: left; transition: background 0.1s; width: 100%;
        }
        .break-option:hover { background: var(--gray-50); }
        .break-option.break-option-on { background: var(--indigo-light); color: var(--indigo); font-weight: 600; }
        .break-check { font-size: 11px; color: var(--indigo); }
        .break-picker-divider {
          font-size: 10px; color: var(--gray-400); font-weight: 500; text-align: center;
          padding: 3px 0; border-top: 1px solid var(--gray-100); border-bottom: 1px solid var(--gray-100); margin: 2px 0;
        }
        .break-picker-done {
          background: var(--indigo); color: white; border: none; border-radius: var(--radius-sm);
          padding: 8px; font-family: 'Inter', sans-serif; font-weight: 600; font-size: 13px;
          cursor: pointer; margin-top: 3px; transition: background 0.15s; width: 100%;
        }
        .break-picker-done:hover { background: var(--indigo-dark); }

        /* ── CAMP CARDS ── */
        .camp-cards { display: flex; flex-direction: column; gap: 8px; }

        .camp-card {
          background: var(--white); border-radius: var(--radius-lg);
          border: 1px solid var(--gray-200);
          padding: 12px 14px;
          box-shadow: var(--shadow-sm);
          transition: box-shadow 0.15s, transform 0.15s;
          position: relative;
        }
        .camp-card:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.1); transform: translateY(-1px); }
        .camp-card.my-kids { background: #eef5e8; }
        .camp-card-layout { display: flex; gap: 12px; align-items: flex-start; }
        .camp-info { flex: 1; min-width: 0; }
        .camp-people-col { flex-shrink: 0; display: flex; flex-direction: column; gap: 7px; align-items: flex-end; min-width: 100px; }

        .camp-name { font-weight: 700; font-size: 14px; color: var(--gray-900); }
        .camp-link { text-decoration: none; }
        .camp-link:hover { text-decoration: underline; }
        .camp-card.my-kids .camp-name { color: var(--gray-900); }
        .camp-meta { font-size: 11.5px; color: var(--gray-500); font-weight: 400; margin-top: 2px; }
        .camp-location-link { color: inherit; text-decoration: none; font-weight: 500; }
        .camp-location-link:hover { text-decoration: underline; color: var(--indigo); }
        .camp-hours { white-space: nowrap; }

        .camp-days-row { display: flex; gap: 3px; margin-top: 6px; }
        .camp-day {
          display: inline-flex; align-items: center; justify-content: center;
          width: 20px; height: 20px; border-radius: 4px;
          font-size: 9px; font-weight: 700;
          border: 1px solid var(--gray-200); color: var(--gray-300); background: transparent;
        }
        .camp-day.camp-day-on { color: white; border-color: transparent; }

        .care-tag {
          font-size: 9px; font-weight: 700; background: var(--sky); color: white;
          border-radius: 3px; padding: 1px 4px; letter-spacing: 0.2px;
        }

        .share-btn {
          display: flex; align-items: center; gap: 4px;
          background: none; border: 1px solid var(--gray-200); border-radius: var(--radius);
          padding: 4px 9px; cursor: pointer;
          font-family: 'Inter', sans-serif; font-size: 11px; font-weight: 500;
          color: var(--gray-400); transition: all 0.15s;
        }
        .share-btn:hover { border-color: var(--gray-300); color: var(--gray-600); }

        .share-picker {
          position: absolute; top: calc(100% + 6px); right: 0; z-index: 200;
          background: white; border-radius: var(--radius-lg);
          box-shadow: 0 10px 25px rgba(0,0,0,0.12); border: 1px solid var(--gray-200);
          padding: 4px; min-width: 160px; display: flex; flex-direction: column; gap: 1px;
        }
        .share-option {
          display: flex; align-items: center; gap: 8px;
          background: none; border: none; border-radius: var(--radius-sm);
          padding: 8px 10px; cursor: pointer;
          font-family: 'Inter', sans-serif; font-size: 13px; font-weight: 500;
          color: var(--gray-700); text-decoration: none; transition: background 0.1s;
          width: 100%; text-align: left;
        }
        .share-option:hover { background: var(--gray-50); }
        .share-icon { font-size: 14px; width: 18px; text-align: center; }

        .camp-card-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
        .camp-card-bottom { display: none; }
        .add-kid-to-camp-row { display: flex; gap: 5px; flex-wrap: wrap; justify-content: flex-end; }

        .kid-status-btn {
          display: flex; align-items: center; gap: 5px;
          border: none; border-radius: 7px; padding: 3px 9px 3px 4px;
          cursor: pointer; font-family: 'Inter', sans-serif;
          font-size: 11px; font-weight: 600; color: white; transition: all 0.15s; opacity: 0.9;
        }
        .kid-status-btn:hover { opacity: 1; transform: translateY(-1px); }
        .kid-status-initials {
          width: 18px; height: 18px; border-radius: 50%;
          background: rgba(255,255,255,0.25);
          display: flex; align-items: center; justify-content: center;
          font-size: 8px; font-weight: 700; flex-shrink: 0;
        }
        .kid-status-label { letter-spacing: 0; }

        .add-camp-btn {
          background: none; border: 1.5px dashed var(--gray-300);
          border-radius: 7px; padding: 3px 10px;
          font-family: 'Inter', sans-serif; font-size: 11px; font-weight: 600;
          color: var(--gray-500); cursor: pointer; transition: all 0.15s;
        }
        .add-camp-btn:hover { background: var(--indigo-light); border-color: var(--indigo); color: var(--indigo); border-style: solid; }

        .status-icon-wrap { display: inline-flex; align-items: center; justify-content: center; }
        .status-icon-sm { display: inline-flex; align-items: center; justify-content: center; }
        .friend-status-icon {
          position: absolute; bottom: -3px; right: -3px;
          width: 13px; height: 13px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 0 0 2px white;
        }
        .status-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }

        .show-more-btn {
          background: none; border: 1px solid var(--gray-200);
          border-radius: var(--radius); padding: 7px 16px; width: 100%;
          font-family: 'Inter', sans-serif; font-size: 12.5px; font-weight: 500;
          color: var(--gray-500); cursor: pointer; transition: all 0.15s; margin-top: 2px;
        }
        .show-more-btn:hover { background: var(--gray-50); border-color: var(--gray-300); color: var(--gray-700); }
        .show-more-btn.show-less { opacity: 0.6; }
        .show-more-btn.show-less:hover { opacity: 1; }

        .empty-state {
          background: var(--white); border-radius: var(--radius-xl); padding: 36px;
          text-align: center; color: var(--gray-400); font-size: 13.5px;
          border: 1.5px dashed var(--gray-200);
        }
        .empty-emoji { font-size: 26px; margin-bottom: 8px; }

        .friend-avatars-row { display: flex; flex-direction: column; gap: 5px; align-items: flex-end; }
        .friend-stack { display: flex; align-items: center; flex-direction: row; }
        .friend-stack .friend-avatar { position: relative; }
        .friend-stack .initials-circle { box-shadow: 0 0 0 2px white; }
        .friend-avatar {
          position: relative; display: inline-flex;
          align-items: center; justify-content: center; cursor: default;
        }
        .friend-avatar .initials-circle {
          width: 26px; height: 26px; border-radius: 50%;
          background: #818CF8; color: white;
          display: flex; align-items: center; justify-content: center;
          font-size: 9px; font-weight: 700; flex-shrink: 0;
        }
        .friend-overflow {
          width: 26px; height: 26px; border-radius: 50%;
          background: var(--gray-200); color: var(--gray-600);
          display: flex; align-items: center; justify-content: center;
          font-size: 9px; font-weight: 700; box-shadow: 0 0 0 2px white; flex-shrink: 0;
        }
        .friend-avatar .tooltip {
          position: absolute; bottom: calc(100% + 5px); left: 50%;
          transform: translateX(-50%);
          background: var(--gray-900); color: white;
          font-size: 11px; font-weight: 500; padding: 4px 8px; border-radius: 6px;
          white-space: nowrap; pointer-events: none; opacity: 0; transition: opacity 0.15s; z-index: 50;
        }
        .friend-avatar .tooltip::after {
          content: ''; position: absolute; top: 100%; left: 50%;
          transform: translateX(-50%);
          border: 4px solid transparent; border-top-color: var(--gray-900);
        }
        .friend-avatar:hover .tooltip { opacity: 1; }

        .kid-avatar {
          width: 40px; height: 40px; border-radius: 50%; color: white;
          display: flex; align-items: center; justify-content: center;
          font-size: 12px; font-weight: 700; flex-shrink: 0;
        }
        .initials-sm {
          width: 22px; height: 22px; border-radius: 50%; color: white;
          background: var(--indigo); display: inline-flex; align-items: center; justify-content: center;
          font-size: 8px; font-weight: 700; vertical-align: middle; margin-right: 3px;
        }

        /* ── MONTHLY CALENDAR ── */
        .monthly-header { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 16px; }
        .month-title { font-size: 20px; font-weight: 700; color: var(--gray-900); min-width: 180px; text-align: center; }
        .month-nav-btn {
          background: var(--white); border: 1px solid var(--gray-200); border-radius: var(--radius);
          width: 32px; height: 32px; font-size: 16px; cursor: pointer; color: var(--gray-600);
          display: flex; align-items: center; justify-content: center; transition: all 0.15s;
        }
        .month-nav-btn:hover { background: var(--gray-50); border-color: var(--gray-300); color: var(--gray-900); }

        .cal-grid {
          display: grid; grid-template-columns: repeat(7, 1fr);
          border: 1px solid var(--gray-200); border-radius: var(--radius-xl); overflow: hidden;
          margin-bottom: 20px; background: var(--white);
        }
        .cal-dow {
          background: var(--gray-50); color: var(--gray-500);
          text-align: center; padding: 8px 4px;
          font-size: 10.5px; font-weight: 600; letter-spacing: 0.5px;
          border-bottom: 1px solid var(--gray-200);
        }
        .cal-cell {
          background: var(--white); min-height: 80px;
          padding: 5px 5px 4px; position: relative;
          display: flex; flex-direction: column; gap: 2px;
          border-right: 1px solid var(--gray-100); border-bottom: 1px solid var(--gray-100);
        }
        .cal-cell:nth-child(7n) { border-right: none; }
        .cal-cell.cal-empty { background: var(--gray-50); }
        .cal-cell.cal-today { background: var(--indigo-light); }
        .cal-day-num {
          font-size: 11px; font-weight: 600; color: var(--gray-500); margin-bottom: 1px;
          width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; border-radius: 50%;
        }
        .cal-cell.cal-today .cal-day-num { background: var(--indigo); color: white; font-weight: 700; }
        .cal-special {
          font-size: 8.5px; font-weight: 700; border-radius: 3px;
          padding: 2px 4px; line-height: 1.3; word-break: break-word;
        }
        .cal-camp-pill {
          border-radius: 3px; padding: 1px 4px;
          display: flex; align-items: center; justify-content: space-between; gap: 2px;
        }
        .cal-camp-name { font-size: 8px; font-weight: 700; color: white; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; }
        .cal-camp-kids { font-size: 7px; font-weight: 800; color: rgba(255,255,255,0.75); white-space: nowrap; flex-shrink: 0; }

        /* ── SPECIAL DATES ── */
        .special-dates-section {
          background: var(--white); border-radius: var(--radius-xl);
          padding: 16px; border: 1px solid var(--gray-200);
        }
        .special-dates-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
        .add-date-btn {
          background: none; border: none; cursor: pointer;
          font-family: 'Inter', sans-serif; font-size: 12px; font-weight: 600;
          color: var(--indigo); transition: all 0.15s; display: flex; align-items: center; gap: 4px;
        }
        .add-date-btn:hover { color: var(--indigo-dark); }
        .add-date-form {
          display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
          margin-bottom: 12px; padding: 10px 12px; background: var(--gray-50); border-radius: var(--radius);
        }
        .date-input, .date-label-input {
          padding: 7px 10px; border: 1px solid var(--gray-200); border-radius: var(--radius);
          font-family: 'Inter', sans-serif; font-size: 13px; color: var(--gray-900);
          outline: none; transition: border-color 0.15s; background: var(--white);
        }
        .date-input:focus, .date-label-input:focus { border-color: var(--indigo); }
        .date-label-input { flex: 1; min-width: 150px; }
        .special-dates-list { display: flex; flex-direction: column; }
        .special-date-row {
          display: flex; align-items: center; gap: 10px;
          padding: 8px 0; border-bottom: 1px solid var(--gray-100);
        }
        .special-date-row:last-child { border-bottom: none; }
        .special-date-dot { width: 8px; height: 8px; border-radius: 2px; flex-shrink: 0; }
        .special-date-label { font-weight: 500; font-size: 13px; color: var(--gray-800); flex: 1; }
        .special-date-date { font-size: 12px; color: var(--gray-400); }
        .special-date-remove {
          background: none; border: none; cursor: pointer; color: var(--gray-300); font-size: 16px; line-height: 1; padding: 0 3px; transition: color 0.15s;
        }
        .special-date-remove:hover { color: var(--red); }

        /* ── CIRCLES TAB ── */
        .liveCircles-grid { display: flex; flex-direction: column; gap: 10px; }
        .circle-card { background: var(--white); border-radius: var(--radius-xl); border: 1px solid var(--gray-200); overflow: hidden; box-shadow: var(--shadow-sm); }
        .circle-header { padding: 14px 16px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; transition: background 0.1s; }
        .circle-header:hover { background: var(--gray-50); }
        .circle-header-left { display: flex; align-items: center; gap: 10px; }
        .circle-icon { width: 38px; height: 38px; border-radius: var(--radius); display: flex; align-items: center; justify-content: center; }
        .circle-name { font-size: 15px; font-weight: 700; color: var(--gray-900); }
        .circle-count { font-size: 12px; color: var(--gray-400); margin-top: 1px; }
        .circle-chevron { font-size: 14px; color: var(--gray-400); transition: transform 0.2s; }
        .circle-chevron.open { transform: rotate(180deg); }
        .circle-members { padding: 0 16px 14px; border-top: 1px solid var(--gray-100); }
        .member-row { display: flex; align-items: center; justify-content: space-between; padding: 9px 0; border-bottom: 1px solid var(--gray-100); cursor: pointer; }
        .member-row:last-child { border-bottom: none; }
        .member-left { display: flex; align-items: center; gap: 10px; }
        .member-avatar-wrap { width: 34px; height: 34px; border-radius: 50%; background: var(--gray-100); border: 1px solid var(--gray-200); display: flex; align-items: center; justify-content: center; font-size: 14px; }
        .member-name { font-weight: 600; font-size: 13.5px; color: var(--gray-800); }
        .member-child { font-size: 11.5px; color: var(--gray-400); }
        .member-camp-count { font-size: 11.5px; font-weight: 600; color: var(--indigo); background: var(--indigo-light); padding: 3px 9px; border-radius: 7px; }
        .member-camps-detail { background: var(--gray-50); border-radius: var(--radius); padding: 9px 11px; margin-bottom: 5px; display: flex; flex-direction: column; gap: 5px; }
        .member-camp-pill { display: flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 500; color: var(--gray-600); }

        .invite-btn {
          display: block; width: 100%; margin-top: 8px;
          background: none; border: 1.5px dashed var(--gray-300);
          border-radius: var(--radius); padding: 7px;
          font-family: 'Inter', sans-serif; font-size: 12.5px; font-weight: 600;
          color: var(--gray-500); cursor: pointer; transition: all 0.15s; text-align: center;
        }
        .invite-btn:hover { background: var(--indigo-light); border-color: var(--indigo); color: var(--indigo); border-style: solid; }
        .invite-form { margin-top: 8px; padding: 10px 12px; background: var(--gray-50); border-radius: var(--radius); display: flex; flex-direction: column; gap: 9px; }
        .invite-form-title { font-size: 12px; font-weight: 700; color: var(--gray-700); }
        .invite-input-row { display: flex; gap: 6px; }
        .invite-send-btn {
          background: var(--indigo); color: white; border: none; border-radius: var(--radius);
          padding: 8px 14px; cursor: pointer; font-family: 'Inter', sans-serif; font-weight: 600; font-size: 13px;
          white-space: nowrap; transition: all 0.15s; flex-shrink: 0;
        }
        .invite-send-btn:disabled { opacity: 0.35; cursor: default; }
        .invite-send-btn:not(:disabled):hover { background: var(--indigo-dark); }
        .invite-sent { font-weight: 700; color: var(--green); font-size: 13.5px; text-align: center; padding: 6px 0; }
        .invite-or { font-size: 11px; font-weight: 500; color: var(--gray-400); text-align: center; }
        .invite-share-row { display: flex; gap: 5px; flex-wrap: wrap; }
        .invite-share-btn {
          flex: 1; text-align: center; padding: 7px 8px;
          background: var(--white); border: 1px solid var(--gray-200); border-radius: var(--radius);
          font-family: 'Inter', sans-serif; font-size: 12px; font-weight: 500;
          color: var(--gray-600); text-decoration: none; cursor: pointer; transition: all 0.15s; white-space: nowrap;
        }
        .invite-share-btn:hover { border-color: var(--indigo); color: var(--indigo); background: var(--indigo-light); }
        .invite-cancel { background: none; border: none; font-family: 'Inter', sans-serif; font-size: 12px; font-weight: 500; color: var(--gray-400); cursor: pointer; text-align: center; padding: 0; }
        .invite-cancel:hover { color: var(--gray-600); }

        .add-circle-btn {
          background: none; border: 1.5px dashed var(--gray-300);
          border-radius: var(--radius-xl); padding: 16px; width: 100%;
          cursor: pointer; color: var(--gray-500); font-family: 'Inter', sans-serif;
          font-size: 13.5px; font-weight: 600; transition: all 0.15s; text-align: center;
        }
        .add-circle-btn:hover { background: var(--indigo-light); border-color: var(--indigo); color: var(--indigo); }
        .add-circle-form { background: var(--white); border-radius: var(--radius-xl); padding: 18px; border: 1px solid var(--gray-200); }
        .add-circle-form input {
          width: 100%; padding: 9px 13px; border: 1px solid var(--gray-200);
          border-radius: var(--radius); font-family: 'Inter', sans-serif;
          font-size: 14px; color: var(--gray-900); outline: none; margin-bottom: 10px; background: var(--white);
        }
        .add-circle-form input:focus { border-color: var(--indigo); }
        .form-btns { display: flex; gap: 8px; }

        .btn-primary {
          background: var(--indigo); color: white; border: none;
          border-radius: var(--radius); padding: 9px 18px;
          font-family: 'Inter', sans-serif; font-weight: 600; font-size: 13.5px;
          cursor: pointer; transition: all 0.15s;
        }
        .btn-primary:hover { background: var(--indigo-dark); }
        .btn-primary:disabled { opacity: 0.4; cursor: default; }
        .btn-ghost {
          background: none; border: 1px solid var(--gray-200); color: var(--gray-600);
          border-radius: var(--radius); padding: 9px 15px;
          font-family: 'Inter', sans-serif; font-weight: 500; font-size: 13.5px; cursor: pointer; transition: all 0.15s;
        }
        .btn-ghost:hover { border-color: var(--gray-300); color: var(--gray-800); }

        /* ── ADD CAMP FORM ── */
        .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
        @media(max-width: 600px) { .form-grid { grid-template-columns: 1fr; } }
        .form-field { display: flex; flex-direction: column; gap: 4px; }
        .form-field.full { grid-column: 1 / -1; }
        .form-input {
          padding: 8px 12px; border: 1px solid var(--gray-200); border-radius: var(--radius);
          font-family: 'Inter', sans-serif; font-size: 13px; color: var(--gray-900);
          outline: none; transition: border-color 0.15s; width: 100%; background: var(--white);
        }
        .form-input:focus { border-color: var(--indigo); }
        .import-label { display: block; font-size: 11.5px; font-weight: 600; color: var(--gray-600); }
        .optional-tag { font-weight: 400; font-size: 10px; color: var(--gray-400); }
        .days-picker-row { display: flex; gap: 5px; }
        .day-picker-btn {
          width: 32px; height: 32px; border-radius: var(--radius-sm);
          border: 1px solid var(--gray-200); background: var(--white);
          font-family: 'Inter', sans-serif; font-size: 11px; font-weight: 600;
          color: var(--gray-400); cursor: pointer; transition: all 0.15s;
        }
        .day-picker-btn.active { background: var(--indigo); border-color: var(--indigo); color: white; }
        .day-picker-unavailable { opacity: 0.2; cursor: not-allowed !important; }
        .import-card { background: var(--white); border-radius: var(--radius-xl); padding: 20px; border: 1px solid var(--gray-200); box-shadow: var(--shadow-sm); }
        .import-textarea {
          width: 100%; padding: 10px 12px; border: 1px solid var(--gray-200); border-radius: var(--radius);
          font-family: 'Inter', sans-serif; font-size: 13px; color: var(--gray-900); resize: vertical;
          outline: none; transition: border-color 0.15s; line-height: 1.6; background: var(--white);
        }
        .import-textarea:focus { border-color: var(--indigo); }
        .import-error { margin-top: 8px; color: var(--red); font-size: 13px; font-weight: 500; }
        .import-success {
          background: var(--green-light); color: var(--green);
          border-radius: var(--radius-xl); padding: 24px; text-align: center;
          font-size: 20px; font-weight: 700; border: 1px solid #86EFAC;
        }
        .import-preview-label { font-size: 10px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: var(--gray-400); margin-bottom: 8px; }
        .import-preview-card { border-left: 4px solid; border-radius: var(--radius); padding: 10px 14px; background: var(--gray-50); margin-bottom: 16px; }
        .import-preview-name { font-weight: 700; font-size: 14px; color: var(--gray-900); margin-bottom: 3px; }
        .import-preview-meta { font-size: 12px; color: var(--gray-400); margin-bottom: 2px; }
        .import-assign { display: flex; flex-direction: column; gap: 12px; }
        .import-assign-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
        .import-assign-row .import-label { margin-bottom: 0; white-space: nowrap; min-width: 54px; }
        .add-mode-toggle { display: none; }

        /* ── CAMP SUGGESTIONS ── */
        .camp-suggestions {
          position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 200;
          background: var(--white); border-radius: var(--radius-lg);
          box-shadow: 0 10px 25px rgba(0,0,0,0.12); border: 1px solid var(--gray-200); overflow: hidden;
        }
        .suggestions-header { padding: 7px 12px 5px; font-size: 10px; font-weight: 700; color: var(--gray-400); text-transform: uppercase; letter-spacing: 0.7px; border-bottom: 1px solid var(--gray-100); }
        .suggestion-item { display: block; width: 100%; text-align: left; background: none; border: none; cursor: pointer; padding: 8px 12px; transition: background 0.1s; border-bottom: 1px solid var(--gray-50); }
        .suggestion-item:last-child { border-bottom: none; }
        .suggestion-item:hover { background: var(--gray-50); }
        .suggestion-name { display: flex; align-items: center; gap: 7px; font-size: 13.5px; font-weight: 600; color: var(--gray-900); }
        .suggestion-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
        .suggestion-meta { font-size: 11px; color: var(--gray-400); margin-top: 2px; padding-left: 15px; }
        .suggestion-friends { font-size: 11px; color: var(--green); font-weight: 600; margin-top: 1px; padding-left: 15px; }

        /* ── DUPLICATE WARNING ── */
        .duplicate-warning {
          width: 100%; display: flex; gap: 10px; align-items: flex-start;
          background: #FFFBEB; border: 1px solid #FCD34D; border-radius: var(--radius); padding: 12px 14px; margin-bottom: 10px;
        }
        .dup-icon { font-size: 16px; flex-shrink: 0; margin-top: 1px; }
        .dup-body { display: flex; flex-direction: column; gap: 4px; flex: 1; }
        .dup-title { font-weight: 700; font-size: 13px; color: #92400E; }
        .dup-sub { font-size: 12px; color: #92400E; line-height: 1.5; }
        .dup-actions { display: flex; gap: 7px; flex-wrap: wrap; margin-top: 3px; }

        /* ── ENROLLMENT MODAL ── */
        .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 16px; overflow-y: auto; }
        .modal-card { background: var(--white); border-radius: var(--radius-xl); padding: 22px; max-width: 400px; width: 100%; box-shadow: 0 20px 50px rgba(0,0,0,0.2); display: flex; flex-direction: column; gap: 18px; max-height: 90vh; overflow-y: auto; }
        .modal-header { display: flex; flex-direction: column; gap: 2px; }
        .modal-title { font-size: 10.5px; font-weight: 700; color: var(--gray-400); text-transform: uppercase; letter-spacing: 0.8px; }
        .modal-camp-name { font-size: 19px; font-weight: 700; color: var(--gray-900); }
        .modal-section { display: flex; flex-direction: column; gap: 8px; }
        .modal-label { font-size: 11.5px; font-weight: 600; color: var(--gray-500); }
        .modal-footer { display: flex; gap: 8px; }

        .care-toggle-btn {
          display: flex; align-items: center; gap: 6px;
          background: var(--white); border: 1px solid var(--gray-200); border-radius: var(--radius);
          padding: 8px 12px; font-family: 'Inter', sans-serif;
          font-size: 13px; font-weight: 500; color: var(--gray-600); cursor: pointer;
          transition: all 0.15s; flex: 1; min-width: 120px;
        }
        .care-toggle-btn:disabled { opacity: 0.35; cursor: not-allowed; }
        .care-toggle-btn:not(:disabled):hover { border-color: var(--sky); }
        .care-toggle-btn.active { background: #F0F9FF; border-color: var(--sky); color: var(--sky); }
        .care-time { font-size: 10px; color: var(--gray-400); margin-left: 2px; }
        .care-toggle-btn.active .care-time { color: var(--sky); }
        .care-na { font-size: 10px; color: var(--gray-300); }
        .care-tag { font-size: 9px; font-weight: 700; background: var(--sky); color: white; border-radius: 3px; padding: 1px 4px; }

        /* ── BOTTOM SHEET ── */
        .bottom-sheet-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 500; display: flex; align-items: flex-end; justify-content: center; animation: fadeIn 0.16s ease; }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        .bottom-sheet { background: var(--white); border-radius: 20px 20px 0 0; width: 100%; max-width: 480px; padding: 10px 14px 36px; animation: slideUp 0.22s cubic-bezier(0.32,0.72,0,1); display: flex; flex-direction: column; gap: 2px; }
        @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        .bottom-sheet-handle { width: 32px; height: 4px; border-radius: 2px; background: var(--gray-200); margin: 0 auto 12px; }
        .bottom-sheet-title { font-size: 12.5px; font-weight: 600; color: var(--gray-700); padding: 0 4px 10px; border-bottom: 1px solid var(--gray-100); margin-bottom: 4px; }
        .bottom-sheet-option { display: flex; align-items: center; gap: 12px; background: none; border: none; border-radius: var(--radius-lg); padding: 10px 8px; cursor: pointer; font-family: 'Inter', sans-serif; transition: background 0.1s; width: 100%; text-align: left; }
        .bottom-sheet-option:hover { background: var(--gray-50); }
        .bottom-sheet-option.selected { background: var(--green-light); }
        .bottom-sheet-icon { width: 36px; height: 36px; border-radius: var(--radius); flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
        .bottom-sheet-option-label { font-size: 15px; font-weight: 500; color: var(--gray-900); flex: 1; }
        .bottom-sheet-check { font-size: 14px; font-weight: 700; color: var(--green); }
        .bottom-sheet-remove { margin-top: 2px; }
        .bottom-sheet-cancel { margin-top: 8px; padding: 13px; border-radius: var(--radius-lg); background: var(--gray-100); border: none; width: 100%; font-family: 'Inter', sans-serif; font-size: 14px; font-weight: 600; color: var(--gray-600); cursor: pointer; transition: background 0.12s; }
        .bottom-sheet-cancel:hover { background: var(--gray-200); }

        /* ── MISC ── */
        .weekly-section { margin-bottom: 20px; }
        .weekly-section-label { font-size: 10.5px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: var(--gray-400); margin-bottom: 8px; padding-left: 2px; }
        .kids-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px; }
        @media(max-width: 600px) { .kids-grid { grid-template-columns: 1fr; } }
        .kid-card { background: var(--white); border-radius: var(--radius-xl); padding: 16px; border: 1px solid var(--gray-200); box-shadow: var(--shadow-sm); }
        .kid-header { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
        .kid-name { font-size: 17px; font-weight: 700; color: var(--gray-900); }
        .kid-camp-count { font-size: 12px; color: var(--gray-400); }
        .kid-camp-list { display: flex; flex-direction: column; gap: 5px; }
        .kid-camp-item { display: flex; align-items: center; gap: 8px; padding: 6px 9px; border-radius: var(--radius); background: var(--gray-50); }
        .kid-camp-item-name { font-weight: 500; font-size: 13px; color: var(--gray-800); }
        .kid-camp-item-date { font-size: 11px; color: var(--gray-400); }
        .add-kid-btn { background: none; border: 1.5px dashed var(--gray-200); border-radius: var(--radius-xl); padding: 16px; width: 100%; cursor: pointer; color: var(--gray-400); font-family: 'Inter', sans-serif; font-size: 13.5px; font-weight: 500; transition: all 0.15s; text-align: center; }
        .add-kid-btn:hover { background: var(--indigo-light); color: var(--indigo); border-color: var(--indigo); }

        .overlap-banner { background: #FFFBEB; border: 1px solid #FCD34D; border-radius: var(--radius); padding: 10px 14px; margin-bottom: 12px; display: flex; align-items: center; gap: 10px; font-size: 13px; font-weight: 500; color: #92400E; }
        .overlap-banner-icon { font-size: 16px; }

        .kid-badges { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 5px; }
        .kid-badge { background: var(--green-light); color: var(--green); border-radius: 7px; padding: 2px 8px; font-size: 11px; font-weight: 600; }
        .friend-badge { background: var(--gray-100); color: var(--gray-600); border-radius: 7px; padding: 2px 8px; font-size: 11px; font-weight: 600; }
        .overlap-badge { background: #FFFBEB; color: #92400E; border-radius: 7px; padding: 2px 8px; font-size: 11px; font-weight: 600; }

        .section-title { font-size: 20px; font-weight: 700; color: var(--gray-900); margin-bottom: 4px; }
        .section-sub { font-size: 13px; color: var(--gray-500); margin-bottom: 20px; }
      `}</style>

      <div className="app">
        {/* HEADER */}
        <header className="header">
          <div className="header-inner">
            <div className="logo">
              Camplify<span className="logo-dot">.</span>
            </div>
            <nav className="nav">
              {window.innerWidth < 768 ? (
                // Mobile: dropdown select
                <select
                  value={activeTab}
                  onChange={e => setActiveTab(e.target.value)}
                  style={{
                    fontFamily: "Inter, sans-serif", fontSize: 14, fontWeight: 600,
                    color: "#1F2937", background: "white", border: "1.5px solid #E5E7EB",
                    borderRadius: 8, padding: "6px 32px 6px 12px", cursor: "pointer",
                    appearance: "none", WebkitAppearance: "none",
                    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236B7280' stroke-width='2.5'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
                    backgroundRepeat: "no-repeat", backgroundPosition: "right 10px center",
                  }}
                >
                  {[
                    { id: "grid", label: "Overview" },
                    { id: "camps", label: "Camps" },
                    { id: "circles", label: "Circles" },
                    { id: "kids", label: "My Kids" },
                    { id: "import", label: "+ Add Camp" },
                  ].map(tab => (
                    <option key={tab.id} value={tab.id}>{tab.label}</option>
                  ))}
                </select>
              ) : (
                // Desktop: pill tabs
                <>
                  {[
                    { id: "grid", label: "Overview" },
                    { id: "camps", label: "Camps" },
                    { id: "circles", label: "Circles" },
                    { id: "kids", label: "My Kids" },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      className={`nav-btn ${activeTab === tab.id ? "active" : ""}`}
                      onClick={() => setActiveTab(tab.id)}
                    >
                      {tab.label}
                    </button>
                  ))}
                  <button
                    className="nav-add-camp-btn"
                    onClick={() => setActiveTab("import")}
                  >
                    + Add Camp
                  </button>
                </>
              )}
            </nav>
            {/* User menu */}
            {(() => {
              const { signOut } = useClerk();
              return (
                <div style={{ position: "relative", marginLeft: 12 }}>
                  <button
                    onClick={() => setShowUserMenu(v => !v)}
                    style={{
                      width: 36, height: 36, borderRadius: "50%", background: "#3D6B1F",
                      color: "white", display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 13, fontWeight: 700, flexShrink: 0, cursor: "pointer",
                      border: showUserMenu ? "2.5px solid #7BAE5A" : "2.5px solid transparent",
                      transition: "border 0.15s",
                    }}
                    title={parentName || userName}
                  >{(parentName || userName || "P")[0].toUpperCase()}</button>

                  {showUserMenu && (
                    <>
                      <div style={{ position: "fixed", inset: 0, zIndex: 99 }} onClick={() => setShowUserMenu(false)} />
                      <div style={{
                        position: "absolute", top: "calc(100% + 8px)", right: 0,
                        width: 260, background: "white", borderRadius: 14,
                        boxShadow: "0 20px 60px rgba(0,0,0,0.15), 0 4px 16px rgba(0,0,0,0.08)",
                        border: "1px solid #E5E7EB", zIndex: 100, overflow: "hidden",
                      }} onClick={e => e.stopPropagation()}>
                        {/* Header */}
                        <div style={{ background: "#3D6B1F", padding: "14px 16px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                            <div style={{ width: 42, height: 42, borderRadius: "50%", background: "rgba(255,255,255,0.2)", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 800, flexShrink: 0 }}>
                              {(parentName || userName || "P")[0].toUpperCase()}
                            </div>
                            <div>
                              <div style={{ fontSize: 14, fontWeight: 700, color: "white" }}>{parentName || userName}</div>
                              <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.7)", marginTop: 1 }}>{userEmail}</div>
                            </div>
                          </div>
                        </div>

                        {/* Settings */}
                        <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
                          <div>
                            <label style={{ fontSize: 11, fontWeight: 700, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: 5 }}>Your Name</label>
                            <input
                              value={parentName}
                              onChange={e => setParentName(e.target.value)}
                              onBlur={async () => {
                                if (parentName.trim()) {
                                  await updateParentName(userId, parentName.trim()).catch(console.error);
                                  getCircles(userId).then(setAirtableCircles).catch(console.error);
                                }
                              }}
                              placeholder="Your name (shown to other parents)"
                              style={{ width: "100%", padding: "8px 10px", border: "1.5px solid #E5E7EB", borderRadius: 8, fontFamily: "Inter, sans-serif", fontSize: 13, fontWeight: 500, color: "#1F2937", outline: "none", boxSizing: "border-box" }}
                              onFocus={e => e.target.style.borderColor = "#3D6B1F"}
                            />
                          </div>

                          {kids.length > 0 && (
                            <div>
                              <label style={{ fontSize: 11, fontWeight: 700, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: 5 }}>My Kids</label>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                {kids.map(k => (
                                  <button key={k.id} onClick={() => { setProfileKidId(k.id); setActiveTab("kids"); setShowUserMenu(false); }}
                                    style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", borderRadius: 20, border: "1.5px solid #E5E7EB", background: "white", fontFamily: "Inter, sans-serif", fontSize: 12, fontWeight: 600, color: "#374151", cursor: "pointer" }}>
                                    <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#3D6B1F", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, fontWeight: 800 }}>{k.initials}</div>
                                    {k.name}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>

                        <div style={{ borderTop: "1px solid #F3F4F6", padding: "10px 16px" }}>
                          <button
                            onClick={() => signOut()}
                            style={{ width: "100%", background: "none", border: "1px solid #E5E7EB", borderRadius: 8, padding: "8px", fontFamily: "Inter, sans-serif", fontSize: 13, fontWeight: 600, color: "#6B7280", cursor: "pointer" }}
                            onMouseEnter={e => { e.currentTarget.style.background = "#F9FAFB"; e.currentTarget.style.color = "#374151"; }}
                            onMouseLeave={e => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "#6B7280"; }}
                          >Sign out</button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              );
            })()}
          </div>
        </header>

        <main className="main" style={activeTab === "grid" ? { maxWidth: "none", padding: window.innerWidth < 768 ? "16px 12px 80px" : "24px 32px 80px" } : {}}>
          {/* ── GRID TAB ── */}
          {activeTab === "grid" && (() => {
            const allCampPool = [...camps, ...airtableCamps, ...dynamicCamps];



            // Which circle members to show as rows (based on selectedCircles filter)
            const activeCircles = selectedCircles.size > 0
              ? liveCircles.filter(c => selectedCircles.has(c.id))
              : liveCircles;
            const friendRows = activeCircles.flatMap(c =>
              c.members
                .filter(m => m.userId !== userId)
                .filter(m => m.visible !== false)
                .map(m => ({ ...m, circleId: c.id, circleColor: c.color, circleName: c.name }))
            ).filter((m, i, arr) =>
              arr.findIndex(x => x.userId === m.userId && x.child === m.child) === i
            ).sort((a, b) => {
              // BFFs (from any of my kids) float to the top
              const myKidBffs = kids.flatMap(k => Array.from(getBffs(k.id)));
              const aIsBff = a.userId ? myKidBffs.includes(a.userId) : false;
              const bIsBff = b.userId ? myKidBffs.includes(b.userId) : false;
              return aIsBff === bIsBff ? 0 : aIsBff ? -1 : 1;
            });

            // My kids rows come first
            const myKidRows = kids.map(k => ({ ...k, isMyKid: true }));

            // Build a map: personKey -> weekNum -> [camp]
            const getPersonCamps = (personCamps, campWeeks, personBreaks, personCampStatus) => {
              const byWeek = {};
              visibleWeeks.forEach(w => { byWeek[w.num] = []; });
              allCampPool.forEach(camp => {
                if (personCamps.includes(camp.id)) {
                  const enrolledWeeks = campWeeks?.[camp.id] || [];
                  const status = personCampStatus?.[camp.id] || 'enrolled';
                  visibleWeeks.forEach(w => {
                    if (campInWeek(camp, w.num)) {
                      if (enrolledWeeks.length === 0 || enrolledWeeks.includes(w.num)) {
                        byWeek[w.num].push({ ...camp, kidStatus: status });
                      }
                    }
                  });
                }
              });
              // Add breaks
              if (personBreaks) {
                personBreaks.forEach(b => {
                  if (byWeek[b.weekIso] !== undefined) {
                    byWeek[b.weekIso] = [{ __break: true, label: b.label || "Break" }];
                  }
                });
              }
              return byWeek;
            };

            const getKidCamps = (kid) => {
              const byWeek = {};
              visibleWeeks.forEach(w => { byWeek[w.num] = []; });
              allCampPool.forEach(camp => {
                const status = campStatus[camp.id]?.[kid.id];
                if (status) {
                  const s = typeof status === "string" ? status : status.status;
                  const enrolledWeeks = status?.weeks || null;
                  if (s) {
                    visibleWeeks.forEach(w => {
                      if (campInWeek(camp, w.num)) {
                        if (!enrolledWeeks || enrolledWeeks.length === 0 || enrolledWeeks.includes(w.num)) {
                          byWeek[w.num].push({ ...camp, kidStatus: s });
                        }
                      }
                    });
                  }
                }
              });
              visibleWeeks.forEach(w => {
                if (kidBreaks[kid.id]?.has(w.num)) byWeek[w.num] = [{ __break: true, label: kidBreaks[kid.id].get(w.num) || "Break" }];
              });
              return byWeek;
            };


            const COL_W = 148;
            const NAME_W = 130;
            const allRows = [
              ...myKidRows.map(k => ({ ...k, isMyKid: true })),
              ...friendRows,
            ];

            const isMobile = window.innerWidth < 768;

            const showTip = (e, text) => {
              if (!text) return;
              const tip = document.createElement("div");
              tip.id = "cell-tip";
              tip.textContent = text;
              tip.style.cssText = "position:fixed;background:#1F2937;color:white;font-size:11px;font-weight:600;padding:5px 10px;border-radius:7px;z-index:9999;pointer-events:none;white-space:nowrap;font-family:Inter,sans-serif;max-width:220px;";
              const r = e.currentTarget.getBoundingClientRect();
              tip.style.left = (r.left + r.width/2) + "px";
              tip.style.top = (r.top - 36) + "px";
              tip.style.transform = "translateX(-50%)";
              document.body.appendChild(tip);
            };
            const hideTip = () => { const t = document.getElementById("cell-tip"); if (t) t.remove(); };

            // ── MOBILE: one week at a time ──
            if (isMobile) {
              const mobileWeekIdx = Math.min(mobileWeekOffset, visibleWeeks.length - 1);
              const w = visibleWeeks[mobileWeekIdx] || visibleWeeks[0];
              if (!w) return null;
              const weekHolidays = getHolidaysInWeek(w.num);
              const allDays = ["M","T","W","Th","F"];
              return (
                <div style={{ padding: "0 0 80px" }}>
                  {/* Week nav */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, background: "white", padding: "12px 16px", borderRadius: 12, border: "1px solid #E5E7EB" }}>
                    <button onClick={() => setMobileWeekOffset(o => Math.max(0, o - 1))} disabled={mobileWeekOffset === 0}
                      style={{ background: "none", border: "none", fontSize: 20, cursor: mobileWeekOffset === 0 ? "default" : "pointer", color: mobileWeekOffset === 0 ? "#D1D5DB" : "#374151", padding: "0 8px" }}>←</button>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: "#1F2937" }}>{w.dates}</div>
                      <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 4 }}>
                        {allDays.map((day, i) => {
                          const dayDate = new Date(w.num + "T12:00:00"); dayDate.setDate(dayDate.getDate() + i);
                          const dayIso = toLocalIso(dayDate);
                          const holiday = weekHolidays.find(h => h.date === dayIso);
                          return (
                            <span key={day} style={{ fontSize: 11, fontWeight: 700, color: holiday ? "#EF4444" : "#D1D5DB" }}
                              onMouseEnter={e => holiday && showTip(e, holiday.name)}
                              onMouseLeave={hideTip}
                            >{day}</span>
                          );
                        })}
                      </div>
                    </div>
                    <button onClick={() => setMobileWeekOffset(o => Math.min(visibleWeeks.length - 1, o + 1))} disabled={mobileWeekOffset >= visibleWeeks.length - 1}
                      style={{ background: "none", border: "none", fontSize: 20, cursor: mobileWeekOffset >= visibleWeeks.length - 1 ? "default" : "pointer", color: mobileWeekOffset >= visibleWeeks.length - 1 ? "#D1D5DB" : "#374151", padding: "0 8px" }}>→</button>
                  </div>

                  {/* Kid cards for this week */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {allRows.map((person, pi) => {
                      const byWeek = person.isMyKid ? getKidCamps(person) : getPersonCamps(person.camps, person.campWeeks, person.breaks, person.campStatus);
                      const dayCamps = byWeek[w.num] || [];
                      const isBreak = dayCamps.length === 1 && dayCamps[0].__break;
                      const breakLabel = isBreak ? (dayCamps[0].label || "Break") : null;
                      const camp = !isBreak ? dayCamps[0] : null;
                      const isLastMyKid = person.isMyKid && pi === myKidRows.length - 1;
                      const status = camp?.kidStatus || (camp ? "enrolled" : null);
                      let bg, textColor, border;
                      if (status === "enrolled")      { bg = "#3D6B1F"; textColor = "white";   border = "none"; }
                      else if (status === "thinking") { bg = "#FEF08A"; textColor = "#713F12"; border = "none"; }
                      else if (status === "waitlist") { bg = "#F3F4F6"; textColor = "#6B7280"; border = "1.5px dashed #9CA3AF"; }
                      else                            { bg = "white";   textColor = "#9CA3AF"; border = "1.5px dashed #E5E7EB"; }

                      // Important dates this week for this kid
                      const weekStart = new Date(w.num + "T12:00:00");
                      const weekEnd = new Date(w.num + "T12:00:00"); weekEnd.setDate(weekEnd.getDate() + 6);
                      const kidDatesThisWeek = person.isMyKid
                        ? importantDates.filter(d => d.kidId === person.id && d.dateStart && new Date(d.dateStart + "T12:00:00") <= weekEnd && new Date((d.dateEnd || d.dateStart) + "T12:00:00") >= weekStart)
                        : [];

                      return (
                        <div key={person.isMyKid ? `kid-${person.id}` : `friend-${person.id}`}>
                          {isLastMyKid && friendRows.length > 0 && <div style={{ height: 1, background: "#E5E7EB", margin: "4px 0" }} />}
                          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", background: "white", borderRadius: 12, border: "1px solid #F0F0F0" }}>
                            {/* Avatar */}
                            <div style={{ width: 34, height: 34, borderRadius: "50%", flexShrink: 0, background: person.isMyKid ? "#3D6B1F" : (person.circleColor || "#9CA3AF"), color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800 }}>
                              {person.isMyKid ? person.initials : getMemberInitials(person.child, person.name)}
                            </div>
                            {/* Name */}
                            <div style={{ width: 90, flexShrink: 0 }}>
                              <div onClick={() => { if (person.isMyKid) { setProfileKidId(person.id); setActiveTab("kids"); } else setFriendProfilePopover({ person, x: 20, y: 80 }); }}
                                style={{ fontSize: 13, fontWeight: 700, color: person.isMyKid ? "#3D6B1F" : (person.circleColor || "#374151"), whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", cursor: "pointer", textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: 2 }}>
                                {person.isMyKid ? person.name : (person.child || person.name)}
                              </div>
                              {kidDatesThisWeek.length > 0 && (
                                <div style={{ fontSize: 10, color: "#EF4444", fontWeight: 600, marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                  {kidDatesThisWeek.map(d => d.label).join(", ")}
                                </div>
                              )}
                            </div>
                            {/* Camp cell */}
                            <div style={{ flex: 1, height: 64, borderRadius: 10, background: bg, border, display: "flex", flexDirection: "column", alignItems: "stretch", overflow: "hidden", cursor: camp || isBreak ? "pointer" : person.isMyKid ? "pointer" : "default" }}
                              onClick={e => {
                                if (camp) setGridPopover({ camp, personName: person.isMyKid ? person.name : person.child, x: e.clientX, y: e.clientY });
                                else if (isBreak && person.isMyKid) setGridAddCell({ kidId: person.id, weekNum: w.num, x: e.clientX, y: e.clientY, editBreak: true, breakLabel });
                                else if (!camp && !isBreak && person.isMyKid) setGridAddCell({ kidId: person.id, weekNum: w.num, x: e.clientX, y: e.clientY });
                              }}>
                              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "0 10px" }}>
                                {isBreak && <span style={{ fontSize: 14 }}>🌿</span>}
                                <span style={{ fontSize: 12, fontWeight: 700, color: textColor, textTransform: isBreak || camp ? "uppercase" : "none", letterSpacing: isBreak || camp ? "0.5px" : 0, textAlign: "center" }}>
                                  {camp ? camp.name : isBreak ? breakLabel : person.isMyKid ? "+" : ""}
                                </span>
                              </div>
                              <div style={{ display: "flex" }}>
                                {allDays.map((day, i) => {
                                  const dayDate = new Date(w.num + "T12:00:00"); dayDate.setDate(dayDate.getDate() + i);
                                  const dayIso = toLocalIso(dayDate);
                                  const holiday = weekHolidays.find(h => h.date === dayIso);
                                  const impDate = kidDatesThisWeek.find(d => dayIso >= d.dateStart && dayIso <= (d.dateEnd || d.dateStart));
                                  const isRed = holiday || impDate;
                                  const campDays = camp?.days?.length > 0 ? camp.days : allDays;
                                  const dayActive = camp ? campDays.includes(day) : isBreak;
                                  const dayColor = isRed ? "#EF4444" : dayActive ? (textColor === "white" ? "rgba(255,255,255,0.7)" : `${textColor}99`) : (textColor === "white" ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.12)");
                                  return <div key={day} style={{ flex: 1, textAlign: "center", padding: "2px 0", fontSize: 8, fontWeight: 700, color: dayColor }}>{day}</div>;
                                })}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            }

            // Empty state for brand new users
            if (kids.length === 0 && friendRows.length === 0) {
              return (
                <div style={{ textAlign: "center", padding: "80px 20px" }}>
                  <div style={{ fontSize: 40, marginBottom: 16 }}>🏕️</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "#1F2937", marginBottom: 8 }}>Welcome to Camplify!</div>
                  <div style={{ fontSize: 14, color: "#6B7280", marginBottom: 24, maxWidth: 400, margin: "0 auto 24px" }}>
                    Get started by adding your kids in the My Kids tab, then browse and enroll in camps.
                  </div>
                  <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
                    <button onClick={() => setActiveTab("kids")} style={{ background: "#3D6B1F", border: "none", borderRadius: 10, padding: "10px 20px", fontFamily: "Inter, sans-serif", fontSize: 14, fontWeight: 700, color: "white", cursor: "pointer" }}>+ Add a Kid</button>
                    <button onClick={() => setActiveTab("circles")} style={{ background: "white", border: "1.5px solid #E5E7EB", borderRadius: 10, padding: "10px 20px", fontFamily: "Inter, sans-serif", fontSize: 14, fontWeight: 700, color: "#374151", cursor: "pointer" }}>Join a Circle</button>
                  </div>
                </div>
              );
            }

            // If no camps yet, show prompt
            if (visibleWeeks.length === 0 && computedWeeks.length === 0) {
              return (
                <div style={{ textAlign: "center", padding: "60px 20px" }}>
                  <div style={{ fontSize: 14, color: "#6B7280", marginBottom: 16 }}>No camps added yet - add some to see the schedule grid!</div>
                  <button onClick={() => setActiveTab("import")} style={{ background: "#3D6B1F", border: "none", borderRadius: 10, padding: "10px 20px", fontFamily: "Inter, sans-serif", fontSize: 14, fontWeight: 700, color: "white", cursor: "pointer" }}>+ Add a Camp</button>
                </div>
              );
            }

            return (
              <div style={{ position: "relative" }}>
                {/* Circle filter */}
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 22, flexWrap: "wrap" }}>
                  <button
                    className={`circle-pill ${selectedCircles.size === 0 ? "active" : ""}`}
                    style={selectedCircles.size === 0 ? { background: "#3D6B1F", borderColor: "#3D6B1F" } : { borderColor: "#ddd" }}
                    onClick={() => setSelectedCircles(new Set())}
                  >All Circles</button>
                  {liveCircles.map(c => (
                    <button key={c.id}
                      className={`circle-pill ${selectedCircles.has(c.id) ? "active" : ""}`}
                      style={selectedCircles.has(c.id) ? { background: c.color, borderColor: c.color } : { borderColor: "#ddd" }}
                      onClick={() => toggleCircle(c.id)}
                    >{c.name}</button>
                  ))}
                </div>

                {/* Grid - name column frozen, weeks scroll */}
                <div style={{ position: "relative", display: "flex" }}>
                  {/* Frozen name column */}
                  <div style={{ width: NAME_W, flexShrink: 0, zIndex: 10, background: "#F9FAFB", boxShadow: "3px 0 8px rgba(0,0,0,0.05)" }}>
                    {/* Header spacer */}
                    <div style={{ height: 52, borderBottom: "2px solid #E5E7EB", background: "#F9FAFB" }} />
                    {allRows.map((person, pi) => {
                      const isLastMyKid = person.isMyKid && pi === myKidRows.length - 1;
                      return (
                        <div key={person.isMyKid ? `kid-${person.id}` : `friend-${person.id}`}>
                          <div style={{ height: 110, display: "flex", alignItems: "center", paddingRight: 12, paddingLeft: 0, borderBottom: "1px solid #F0F0F0", gap: 8, background: "#F9FAFB" }}>
                            <div style={{ width: 30, height: 30, borderRadius: "50%", flexShrink: 0, background: person.isMyKid ? "#3D6B1F" : (person.circleColor || "#9CA3AF"), color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800 }}>
                              {person.isMyKid ? person.initials : getMemberInitials(person.child, person.name)}
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 3, minWidth: 0 }}>
                              <span onClick={() => { if (person.isMyKid) { setProfileKidId(person.id); setActiveTab("kids"); } else setFriendProfilePopover({ person, x: 20, y: 80 }); }}
                                style={{ fontSize: 13, fontWeight: 700, color: person.isMyKid ? "#3D6B1F" : (person.circleColor || "#374151"), whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", cursor: "pointer", textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: 2 }}>
                                {person.isMyKid ? person.name : (person.child || person.name)}
                              </span>
                              {!person.isMyKid && person.userId && kids.some(k => getBffs(k.id).has(person.userId)) && (
                                <span style={{ fontSize: 10, lineHeight: 1, flexShrink: 0 }} title="BFF">⭐</span>
                              )}
                            </div>
                          </div>
                          {isLastMyKid && friendRows.length > 0 && <div style={{ height: 2, background: "#E5E7EB" }} />}
                        </div>
                      );
                    })}
                  </div>

                  {/* Scrollable weeks */}
                  <div id="grid-scroll-container" style={{ overflowX: "auto", flex: 1, WebkitOverflowScrolling: "touch", scrollbarWidth: "thin", scrollbarColor: "#E5E7EB transparent" }}>
                    <div style={{ minWidth: visibleWeeks.length * (COL_W + 8) }}>

                      {/* Header row */}
                      <div style={{ display: "flex", height: 52, alignItems: "flex-end", borderBottom: "2px solid #E5E7EB", background: "#F9FAFB" }}>
                        {visibleWeeks.map(w => {
                          const weekStart = new Date(w.num + "T00:00:00");
                          const holidays = getHolidaysInWeek(w.num);
                          const dayLabels = ["M","T","W","Th","F"].map((day, i) => {
                            const dayDate = new Date(weekStart); dayDate.setDate(dayDate.getDate() + i);
                            const dayIso = dayDate.toISOString().slice(0, 10);
                            const importantMatch = importantDates.find(d => {
                              if (!d.dateStart) return false;
                              const ds = new Date(d.dateStart + "T12:00:00");
                              const de = d.dateEnd ? new Date(d.dateEnd + "T12:00:00") : ds;
                              return dayDate >= ds && dayDate <= de;
                            });
                            const holidayMatch = holidays.find(h => h.date === dayIso);
                            return { day, importantMatch, holidayMatch };
                          });
                          return (
                            <div key={w.num} style={{ width: COL_W, flexShrink: 0, marginRight: 8, borderLeft: "1px solid #F0F0F0" }}>
                              <div style={{ fontSize: 10.5, fontWeight: 700, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.8px", textAlign: "center", paddingBottom: 4, paddingTop: 4 }}>
                                {w.dates}
                              </div>
                              <div style={{ display: "flex", borderTop: "1px solid #F0F0F0", paddingBottom: 6 }}>
                                {dayLabels.map(({ day, importantMatch, holidayMatch }) => {
                                  const tooltip = [holidayMatch?.name, importantMatch?.label].filter(Boolean).join(" · ");
                                  const color = holidayMatch ? "#EF4444" : importantMatch ? "#F59E0B" : "#D1D5DB";
                                  return (
                                    <div key={day} style={{ flex: 1, textAlign: "center", paddingTop: 3, fontSize: 8.5, fontWeight: 700, color, cursor: tooltip ? "help" : "default" }}
                                      onMouseEnter={e => {
                                        if (!tooltip) return;
                                        const tip = document.createElement("div");
                                        tip.id = "day-tip";
                                        tip.textContent = tooltip;
                                        tip.style.cssText = "position:fixed;background:#1F2937;color:white;font-size:11px;font-weight:600;padding:4px 8px;border-radius:6px;z-index:9999;pointer-events:none;white-space:nowrap;font-family:Inter,sans-serif;";
                                        const r = e.currentTarget.getBoundingClientRect();
                                        tip.style.left = (r.left + r.width/2) + "px";
                                        tip.style.top = (r.top - 28) + "px";
                                        tip.style.transform = "translateX(-50%)";
                                        document.body.appendChild(tip);
                                      }}
                                      onMouseLeave={() => { const t = document.getElementById("day-tip"); if (t) t.remove(); }}
                                    >
                                      {day}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Week-only rows (names in frozen column) */}
                      {allRows.map((person, pi) => {
                        const byWeek = person.isMyKid ? getKidCamps(person) : getPersonCamps(person.camps, person.campWeeks, person.breaks, person.campStatus);
                        const isLastMyKid = person.isMyKid && pi === myKidRows.length - 1;
                        const allDays = ["M","T","W","Th","F"];
                        return (
                          <div key={person.isMyKid ? `kid-${person.id}` : `friend-${person.id}`}>
                            <div style={{ display: "flex", alignItems: "stretch", height: 110, paddingTop: 8, paddingBottom: 8, borderBottom: "1px solid #F0F0F0" }}>
                              {visibleWeeks.map(w => {
                                const dayCamps = byWeek[w.num] || [];
                                const isBreak = dayCamps.length === 1 && dayCamps[0].__break;
                                const breakLabel = isBreak ? (dayCamps[0].label || "Break") : null;
                                const camp = !isBreak ? dayCamps[0] : null;
                                const status = camp?.kidStatus || (camp ? "enrolled" : null);
                                let bg, textColor, border;
                                if (status === "enrolled")      { bg = "#3D6B1F"; textColor = "white";    border = "none"; }
                                else if (status === "thinking") { bg = "#FEF08A"; textColor = "#713F12";  border = "none"; }
                                else if (status === "waitlist") { bg = "#F3F4F6"; textColor = "#6B7280";  border = "1.5px dashed #9CA3AF"; }
                                else                            { bg = "transparent"; textColor = "#D1D5DB"; border = "none"; }

                                // Find important dates and holidays for this kid this week, mapped per day
                                const weekStart = new Date(w.num + "T12:00:00");
                                const weekEnd = new Date(w.num + "T12:00:00"); weekEnd.setDate(weekEnd.getDate() + 6);
                                const kidImportantDates = person.isMyKid
                                  ? importantDates.filter(d => d.kidId === person.id && d.dateStart && new Date(d.dateStart + "T12:00:00") <= weekEnd && new Date((d.dateEnd || d.dateStart) + "T12:00:00") >= weekStart)
                                  : [];
                                const weekHolidays = getHolidaysInWeek(w.num);
                                // Map each day to its important date label and holiday name
                                const dayImportant = {};
                                const dayHoliday = {};
                                allDays.forEach((day, i) => {
                                  const dayDate = new Date(w.num + "T12:00:00"); dayDate.setDate(dayDate.getDate() + i);
                                  const dayIso = toLocalIso(dayDate);
                                  const match = kidImportantDates.find(d => dayIso >= d.dateStart && dayIso <= (d.dateEnd || d.dateStart));
                                  if (match) dayImportant[day] = match.label;
                                  const holiday = weekHolidays.find(h => h.date === dayIso);
                                  if (holiday) dayHoliday[day] = holiday.name;
                                });
                                const hasImportant = Object.keys(dayImportant).length > 0;
                                return (
                                  <div key={w.num} style={{ width: COL_W, flexShrink: 0, marginRight: 8, display: "flex", alignItems: "stretch" }}>
                                    {isBreak ? (
                                      <div onClick={() => { if (person.isMyKid) setGridAddCell({ kidId: person.id, weekNum: w.num, x: 0, y: 0, editBreak: true, breakLabel }); }}
                                        style={{ width: "100%", borderRadius: 12, background: "#DCFCE7", cursor: person.isMyKid ? "pointer" : "default", display: "flex", flexDirection: "column", alignItems: "stretch", overflow: "hidden", position: "relative" }}>

                                        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, position: "relative" }}>
                                          <span style={{ fontSize: 16 }}>🌿</span>
                                          <span style={{ fontSize: 11, fontWeight: 700, color: "#15803D", textTransform: "uppercase", letterSpacing: "0.5px", textAlign: "center", padding: "0 6px" }}>{breakLabel}</span>
                                        </div>
                                        <div style={{ display: "flex" }}>
                                          {allDays.map(d => (
                                          <div key={d}
                                            style={{ flex: 1, textAlign: "center", padding: "3px 0", fontSize: 8.5, fontWeight: 700, color: dayHoliday[d] ? "#EF4444" : dayImportant[d] ? "#EF4444" : "rgba(21,128,61,0.5)", cursor: (dayHoliday[d] || dayImportant[d]) ? "help" : "default" }}
                                            onMouseEnter={e => (dayHoliday[d] || dayImportant[d]) && showTip(e, [dayHoliday[d], dayImportant[d]].filter(Boolean).join(" · "))}
                                            onMouseLeave={hideTip}
                                          >{d}</div>
                                        ))}
                                        </div>
                                      </div>
                                    ) : !camp ? (
                                      person.isMyKid ? (
                                        <button onClick={e => { e.stopPropagation(); setGridAddCell(prev => prev?.kidId === person.id && prev?.weekNum === w.num ? null : { kidId: person.id, weekNum: w.num, x: e.clientX, y: e.clientY }); }}
                                          style={{ width: "100%", borderRadius: 12, background: "transparent", border: "1.5px dashed #D1D5DB", display: "flex", flexDirection: "column", alignItems: "stretch", cursor: "pointer", transition: "all 0.12s", overflow: "hidden", padding: 0 }}
                                          onMouseEnter={e => { e.currentTarget.style.borderColor = "#3D6B1F"; e.currentTarget.style.background = "#f6faf2"; }}
                                          onMouseLeave={e => { e.currentTarget.style.borderColor = "#D1D5DB"; e.currentTarget.style.background = "transparent"; }}>
                                          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                                            <span style={{ fontSize: 22, color: "#D1D5DB", lineHeight: 1, fontWeight: 300 }}>+</span>
                                          </div>
                                          <div style={{ display: "flex" }}>
                                            {allDays.map(d => (
                                              <div key={d}
                                                style={{ flex: 1, textAlign: "center", padding: "3px 0", fontSize: 8.5, fontWeight: 700, color: dayHoliday[d] ? "#EF4444" : dayImportant[d] ? "#EF4444" : "#D1D5DB", cursor: (dayHoliday[d] || dayImportant[d]) ? "help" : "default" }}
                                                onMouseEnter={e => (dayHoliday[d] || dayImportant[d]) && showTip(e, [dayHoliday[d], dayImportant[d]].filter(Boolean).join(" · "))}
                                                onMouseLeave={hideTip}
                                              >{d}</div>
                                            ))}
                                          </div>
                                        </button>
                                      ) : (
                                        <div style={{ width: "100%", borderRadius: 12, background: "transparent", border: "1.5px dashed #E5E7EB" }} />
                                      )
                                    ) : (
                                      <button onClick={e => { e.stopPropagation(); setGridPopover({ camp, personName: person.isMyKid ? person.name : person.child, x: e.clientX, y: e.clientY }); }}
                                        style={{ width: "100%", borderRadius: 12, background: bg, border, cursor: "pointer", fontFamily: "Inter, sans-serif", display: "flex", flexDirection: "column", alignItems: "stretch", padding: 0, overflow: "hidden", transition: "filter 0.12s", position: "relative" }}
                                        onMouseEnter={e => e.currentTarget.style.filter = "brightness(0.93)"}
                                        onMouseLeave={e => e.currentTarget.style.filter = "none"}>
                                        {(() => {
                                          const campDays = camp.days?.length > 0 ? camp.days : allDays;
                                          return (
                                            <>

                                              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "8px 10px" }}>
                                                <span style={{ fontSize: 11.5, fontWeight: 700, color: textColor, textTransform: "uppercase", letterSpacing: "0.5px", textAlign: "center", lineHeight: 1.35, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", position: "relative" }}>
                                                  {camp.name}
                                                </span>
                                              </div>
                                              <div style={{ display: "flex" }}>
                                                {allDays.map(d => (
                                                <div key={d}
                                                  style={{ flex: 1, textAlign: "center", padding: "3px 0", fontSize: 8.5, fontWeight: 700, color: (dayHoliday[d] || dayImportant[d]) ? "#EF4444" : campDays.includes(d) ? (textColor === "white" ? "rgba(255,255,255,0.8)" : `${textColor}CC`) : (textColor === "white" ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.15)"), cursor: (dayHoliday[d] || dayImportant[d]) ? "help" : "default" }}
                                                  onMouseEnter={e => (dayHoliday[d] || dayImportant[d]) && showTip(e, [dayHoliday[d], dayImportant[d]].filter(Boolean).join(" · "))}
                                                  onMouseLeave={hideTip}
                                                >{d}</div>
                                              ))}
                                              </div>
                                            </>
                                          );
                                        })()}
                                      </button>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                            {isLastMyKid && friendRows.length > 0 && <div style={{ height: 2, background: "#E5E7EB" }} />}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Camp detail popover */}
                {gridPopover && (
                  <div style={{ position: "fixed", inset: 0, zIndex: 50 }} onClick={() => setGridPopover(null)}>
                    <div
                      onClick={e => e.stopPropagation()}
                      style={{
                        position: "fixed",
                        left: Math.min(gridPopover.x + 10, window.innerWidth - 320),
                        top: Math.min(gridPopover.y + 10, window.innerHeight - 280),
                        width: 300, background: "white",
                        borderRadius: "var(--radius-xl)",
                        boxShadow: "0 20px 60px rgba(0,0,0,0.18), 0 4px 16px rgba(0,0,0,0.1)",
                        border: "1px solid #e5e7eb",
                        overflow: "hidden", zIndex: 51,
                      }}
                    >
                      {/* Color bar */}
                      <div style={{ height: 5, background: gridPopover.camp.color }} />
                      <div style={{ padding: "14px 16px 16px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            {gridPopover.camp.url && gridPopover.camp.url !== "#" ? (
                              <a href={gridPopover.camp.url} target="_blank" rel="noreferrer"
                                style={{ fontWeight: 800, fontSize: 14, color: "#1F2937", textDecoration: "none", lineHeight: 1.3, display: "block" }}
                                onMouseEnter={e => e.currentTarget.style.color = gridPopover.camp.color}
                                onMouseLeave={e => e.currentTarget.style.color = "#1F2937"}
                              >{gridPopover.camp.name}</a>
                            ) : (
                              <div style={{ fontWeight: 800, fontSize: 14, color: "#1F2937", lineHeight: 1.3 }}>{gridPopover.camp.name}</div>
                            )}
                            <div style={{ fontSize: 11.5, color: "#6B7280", marginTop: 3 }}>{gridPopover.camp.dates}</div>
                          </div>
                          <button onClick={() => setGridPopover(null)} style={{
                            background: "none", border: "none", cursor: "pointer", fontSize: 18,
                            color: "#9CA3AF", padding: "0 0 0 8px", lineHeight: 1, flexShrink: 0,
                          }}>×</button>
                        </div>

                        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                          {gridPopover.camp.location && (
                            <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                              <div>
                                <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(gridPopover.camp.address || gridPopover.camp.location)}`} target="_blank" rel="noreferrer"
                                  style={{ fontSize: 12, color: "#374151", textDecoration: "none", fontWeight: 500 }}
                                  onMouseEnter={e => e.currentTarget.style.textDecoration = "underline"}
                                  onMouseLeave={e => e.currentTarget.style.textDecoration = "none"}
                                >{gridPopover.camp.location}</a>
                                {gridPopover.camp.address && <div style={{ fontSize: 10.5, color: "#9CA3AF", marginTop: 1 }}>{gridPopover.camp.address}</div>}
                              </div>
                            </div>
                          )}
                          {gridPopover.camp.hours && (
                            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                              <span style={{ fontSize: 12, color: "#374151", fontWeight: 500 }}>{gridPopover.camp.hours}</span>
                            </div>
                          )}
                          {gridPopover.camp.days && (
                            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                              <div style={{ display: "flex", gap: 3 }}>
                                {["M","T","W","Th","F"].map(d => (
                                  <span key={d} style={{
                                    width: 22, height: 22, borderRadius: 4, display: "inline-flex", alignItems: "center", justifyContent: "center",
                                    fontSize: 10, fontWeight: 700,
                                    background: gridPopover.camp.days.includes(d) ? gridPopover.camp.color + "22" : "#F3F4F6",
                                    color: gridPopover.camp.days.includes(d) ? gridPopover.camp.color : "#D1D5DB",
                                    border: `1px solid ${gridPopover.camp.days.includes(d) ? gridPopover.camp.color + "55" : "#E5E7EB"}`,
                                  }}>{d}</span>
                                ))}
                              </div>
                            </div>
                          )}
                          {(gridPopover.camp.ageMin || gridPopover.camp.ageMax) && (
                            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
                              <span style={{ fontSize: 12, color: "#374151", fontWeight: 500 }}>
                                {gridPopover.camp.ageMin && gridPopover.camp.ageMax ? `Ages ${gridPopover.camp.ageMin}–${gridPopover.camp.ageMax}` : gridPopover.camp.ageMin ? `Ages ${gridPopover.camp.ageMin}+` : `Up to age ${gridPopover.camp.ageMax}`}
                              </span>
                            </div>
                          )}
                          {gridPopover.camp.cost && (
                            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                              <span style={{ fontSize: 12, color: "#3D6B1F", fontWeight: 700 }}>${Number(gridPopover.camp.cost).toLocaleString()}</span>
                            </div>
                          )}
                        </div>

                        {/* Friends also at this camp */}
                        {(() => {
                          const othersAtCamp = friendRows.filter(m => m.camps.includes(gridPopover.camp.id));
                          if (othersAtCamp.length === 0) return null;
                          return (
                            <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid #f0f0f0" }}>
                              <div style={{ fontSize: 10.5, fontWeight: 700, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>Also going</div>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                                {othersAtCamp.map(m => (
                                  <span key={m.id} style={{
                                    fontSize: 11, fontWeight: 600, color: m.circleColor,
                                    background: m.circleColor + "15", border: `1px solid ${m.circleColor}30`,
                                    borderRadius: 5, padding: "2px 7px",
                                  }}>{m.child}</span>
                                ))}
                              </div>
                            </div>
                          );
                        })()}

                        <button
                          onClick={() => { setFocusedCampId(gridPopover.camp.id); setExpandedCampId(gridPopover.camp.id); setGridPopover(null); setActiveTab("camps"); }}
                          style={{
                            marginTop: 14, width: "100%", background: "#3D6B1F", color: "white",
                            border: "none", borderRadius: 8, padding: "9px 0",
                            fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 13,
                            cursor: "pointer",
                          }}
                        >View Full Camp Details →</button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Add camp popover - shown on empty my-kid cells */}
                {gridAddCell && (() => {
                  const allCampPool = [...camps, ...airtableCamps, ...dynamicCamps];
                  const kid = kids.find(k => k.id === gridAddCell.kidId);
                  const weekCampsAvail = allCampPool.filter(c =>
                    campInWeek(c, gridAddCell.weekNum) &&
                    !campStatus[c.id]?.[gridAddCell.kidId]
                  );
                  const searchQuery = campSearch.trim().toLowerCase();
                  const filteredCamps = searchQuery
                    ? allCampPool.filter(c => {
                        const name = (c.name || "").toLowerCase();
                        const loc = (c.location || "").toLowerCase();
                        return name.includes(searchQuery) || loc.includes(searchQuery);
                      })
                    : weekCampsAvail;
                  // Break edit mode
                  if (gridAddCell.editBreak) {
                    return (
                      <div style={{ position: "fixed", inset: 0, zIndex: 50 }} onClick={() => setGridAddCell(null)}>
                        <div onClick={e => e.stopPropagation()} style={{
                          position: "fixed",
                          left: Math.min((gridAddCell.x || window.innerWidth / 2) + 10, window.innerWidth - 280),
                          top: Math.min((gridAddCell.y || window.innerHeight / 2) + 10, window.innerHeight - 220),
                          width: 260, background: "white",
                          borderRadius: "var(--radius-xl)",
                          boxShadow: "0 20px 60px rgba(0,0,0,0.15), 0 4px 16px rgba(0,0,0,0.08)",
                          border: "1px solid #e5e7eb", overflow: "hidden", zIndex: 51,
                        }}>
                          <div style={{ background: "#15803D", padding: "10px 14px", borderRadius: "var(--radius-xl) var(--radius-xl) 0 0" }}>
                            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.7)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                              {computedWeeks.find(w => w.num === gridAddCell.weekNum)?.dates}
                            </div>
                            <div style={{ fontSize: 13, color: "white", fontWeight: 700, marginTop: 2 }}>🌿 {gridAddCell.breakLabel} — {kid?.name}</div>
                          </div>
                          <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
                            <div style={{ fontSize: 11.5, fontWeight: 600, color: "#6B7280" }}>Rename break</div>
                            <div style={{ display: "flex", gap: 6 }}>
                              <input
                                autoFocus
                                defaultValue={gridAddCell.breakLabel}
                                id="break-rename-input"
                                style={{ flex: 1, padding: "6px 10px", border: "1.5px solid #E5E7EB", borderRadius: 7, fontFamily: "Inter, sans-serif", fontSize: 13, color: "#1F2937", outline: "none" }}
                                onFocus={e => e.target.style.borderColor = "#15803D"}
                                onBlur={e => e.target.style.borderColor = "#E5E7EB"}
                                onKeyDown={e => {
                                  if (e.key === "Enter") {
                                    setKidBreak(gridAddCell.kidId, gridAddCell.weekNum, e.target.value.trim() || "Break");
                                    setGridAddCell(null);
                                  }
                                  if (e.key === "Escape") setGridAddCell(null);
                                }}
                              />
                              <button onClick={() => {
                                const val = document.getElementById("break-rename-input")?.value?.trim() || "Break";
                                setKidBreak(gridAddCell.kidId, gridAddCell.weekNum, val);
                                setGridAddCell(null);
                              }} style={{ background: "#15803D", border: "none", borderRadius: 7, padding: "6px 12px", fontFamily: "Inter, sans-serif", fontSize: 12, fontWeight: 700, color: "white", cursor: "pointer" }}>Save</button>
                            </div>
                            <button
                              onClick={() => {
                                setKidBreak(gridAddCell.kidId, gridAddCell.weekNum, undefined);
                                setGridAddCell(null);
                              }}
                              style={{ width: "100%", background: "none", border: "1.5px solid #FCA5A5", borderRadius: 7, padding: "7px", fontFamily: "Inter, sans-serif", fontSize: 13, fontWeight: 600, color: "#DC2626", cursor: "pointer", transition: "all 0.15s" }}
                              onMouseEnter={e => { e.currentTarget.style.background = "#FEF2F2"; }}
                              onMouseLeave={e => { e.currentTarget.style.background = "none"; }}
                            >🗑 Remove break</button>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div style={{ position: "fixed", inset: 0, zIndex: 50 }} onClick={() => { setGridAddCell(null); setCampSearch(""); }}>
                      <div
                        onClick={e => e.stopPropagation()}
                        style={{
                          position: "fixed",
                          left: Math.min(gridAddCell.x + 10, window.innerWidth - 300),
                          top: Math.min(gridAddCell.y + 10, window.innerHeight - 420),
                          width: 280, background: "white",
                          borderRadius: "var(--radius-xl)",
                          boxShadow: "0 20px 60px rgba(0,0,0,0.15), 0 4px 16px rgba(0,0,0,0.08)",
                          border: "1px solid #e5e7eb",
                          overflow: "visible", zIndex: 51,
                          maxHeight: "80vh", display: "flex", flexDirection: "column",
                        }}
                      >
                        <div style={{ background: "#3D6B1F", padding: "10px 14px", borderRadius: "var(--radius-xl) var(--radius-xl) 0 0" }}>
                          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.7)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                            {computedWeeks.find(w => w.num === gridAddCell.weekNum)?.dates}
                          </div>
                          <div style={{ fontSize: 13, color: "white", fontWeight: 700, marginTop: 2 }}>
                            Add a camp for {kid?.name}
                          </div>
                        </div>
                        {/* Search input */}
                        <div style={{ padding: "8px 10px", borderBottom: "1px solid #F3F4F6" }}>
                          <input
                            autoFocus
                            placeholder="Search all camps..."
                            value={campSearch}
                            onChange={e => setCampSearch(e.target.value)}
                            style={{ width: "100%", padding: "6px 10px", border: "1.5px solid #E5E7EB", borderRadius: 7, fontFamily: "Inter, sans-serif", fontSize: 13, color: "#1F2937", outline: "none" }}
                            onFocus={e => e.target.style.borderColor = "#3D6B1F"}
                            onBlur={e => e.target.style.borderColor = "#E5E7EB"}
                          />
                          {!campSearch && weekCampsAvail.length > 0 && (
                            <div style={{ fontSize: 10, color: "#9CA3AF", marginTop: 5, paddingLeft: 2 }}>Showing camps this week. Type to search all.</div>
                          )}
                        </div>
                        <div style={{ padding: "4px 0", flex: 1, overflowY: "auto", maxHeight: 280, borderRadius: "0 0 var(--radius-xl) var(--radius-xl)" }}>
                          {filteredCamps.length === 0 ? (
                            <div style={{ padding: "16px 14px", fontSize: 12.5, color: "#9CA3AF", textAlign: "center" }}>
                              {campSearch ? "No camps match your search" : "No camps available this week"}
                            </div>
                          ) : filteredCamps.map(camp => {
                            const enrollment = campStatus[camp.id]?.[gridAddCell.kidId];
                            const enrolledWeeks = enrollment?.weeks || [];
                            const campTotalWeeks = camp.weekRange || [camp.week];
                            // "Already added" only if it's a single-week camp, or all weeks are enrolled
                            const alreadyAdded = !!enrollment && (campTotalWeeks.length <= 1 || enrolledWeeks.length >= campTotalWeeks.length);
                            return (
                              <button key={camp.id}
                                onClick={() => {
                                  if (alreadyAdded) return;
                                  openEnrollModal(camp.id, gridAddCell.kidId, "enrolled", camp.days);
                                  setGridAddCell(null);
                                  setCampSearch("");
                                }}
                                style={{
                                  width: "100%", textAlign: "left", background: "none", border: "none",
                                  padding: "9px 14px", cursor: alreadyAdded ? "default" : "pointer", fontFamily: "Inter, sans-serif",
                                  display: "flex", alignItems: "center", gap: 10, transition: "background 0.1s",
                                  opacity: alreadyAdded ? 0.5 : 1,
                                }}
                                onMouseEnter={e => { if (!alreadyAdded) e.currentTarget.style.background = "#f6faf2"; }}
                                onMouseLeave={e => e.currentTarget.style.background = "none"}
                              >
                                <div style={{ width: 8, height: 8, borderRadius: "50%", background: camp.color, flexShrink: 0 }} />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: 13, fontWeight: 600, color: "#1F2937", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{camp.name}</div>
                                  <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 1 }}>{camp.location} · {camp.dates}</div>
                                </div>
                                {alreadyAdded && <span style={{ fontSize: 10, fontWeight: 700, color: "#9CA3AF", flexShrink: 0 }}>Added ✓</span>}
                              </button>
                            );
                          })}
                        </div>
                        <div style={{ borderTop: "1px solid #F3F4F6" }}>
                          <button
                            onClick={() => { setGridAddCell(null); setActiveTab("import"); setCampSearch(""); }}
                            style={{
                              width: "100%", textAlign: "left", background: "none", border: "none",
                              padding: "9px 14px", cursor: "pointer", fontFamily: "Inter, sans-serif",
                              fontSize: 13, fontWeight: 600, color: "#3D6B1F", transition: "background 0.1s",
                            }}
                            onMouseEnter={e => e.currentTarget.style.background = "#f6faf2"}
                            onMouseLeave={e => e.currentTarget.style.background = "none"}
                          >+ Add a new camp</button>
                        </div>
                        <div style={{ borderTop: "1px solid #F3F4F6", padding: "8px 14px 10px" }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6, display: "flex", alignItems: "center", gap: 5 }}>
                            <span>🌿</span> Mark as break
                          </div>
                          <div style={{ display: "flex", gap: 6 }}>
                            <input
                              placeholder="e.g. Away, Grandparents..."
                              value={breakLabelInput}
                              onChange={e => setBreakLabelInput(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === "Enter") {
                                  setKidBreak(gridAddCell.kidId, gridAddCell.weekNum, breakLabelInput.trim() || "Break");
                                  setBreakLabelInput("");
                                  setGridAddCell(null);
                                }
                                if (e.key === "Escape") setGridAddCell(null);
                              }}
                              style={{
                                flex: 1, padding: "6px 10px", border: "1.5px solid #E5E7EB",
                                borderRadius: 7, fontFamily: "Inter, sans-serif", fontSize: 13,
                                color: "#1F2937", outline: "none",
                              }}
                              onFocus={e => e.target.style.borderColor = "#15803D"}
                              onBlur={e => e.target.style.borderColor = "#E5E7EB"}
                              autoFocus={false}
                            />
                            <button
                              onClick={() => {
                                setKidBreak(gridAddCell.kidId, gridAddCell.weekNum, breakLabelInput.trim() || "Break");
                                setBreakLabelInput("");
                                setGridAddCell(null);
                              }}
                              style={{
                                background: "#15803D", border: "none", borderRadius: 7,
                                padding: "6px 12px", fontFamily: "Inter, sans-serif",
                                fontSize: 12, fontWeight: 700, color: "white", cursor: "pointer",
                              }}
                            >Add</button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}
                {/* Friend mini-profile popover */}
                {friendProfilePopover && (() => {
                  const { person } = friendProfilePopover;
                  const prof = person.profile || {};
                  const isVisible = person.visible !== false;
                  const allCampPool = [...camps, ...airtableCamps, ...dynamicCamps];
                  const friendCamps = allCampPool.filter(c => person.camps?.includes(c.id));
                  const parentLastInitial = person.name?.split(" ")[1]?.[0] || "";
                  const INTEREST_MAP = { sports:"⚽ Sports", art:"🎨 Art", drama:"🎭 Drama", outdoors:"🌲 Outdoors", language:"🌍 Language", classic:"🏕️ Classic", stem:"🔬 STEM", music:"🎵 Music", academics:"📚 Academics", gaming:"🎮 Gaming" };

                  return (
                    <div style={{ position: "fixed", inset: 0, zIndex: 50 }} onClick={() => setFriendProfilePopover(null)}>
                      <div
                        onClick={e => e.stopPropagation()}
                        style={{
                          position: "fixed",
                          left: Math.min(friendProfilePopover.x + 10, window.innerWidth - 290),
                          top: Math.min(friendProfilePopover.y + 10, window.innerHeight - 360),
                          width: 280, background: "white",
                          borderRadius: "var(--radius-xl)",
                          boxShadow: "0 20px 60px rgba(0,0,0,0.15), 0 4px 16px rgba(0,0,0,0.08)",
                          border: "1px solid #e5e7eb", overflow: "hidden", zIndex: 51,
                        }}
                      >
                        {/* Header */}
                        <div style={{ background: person.circleColor, padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
                          <div style={{
                            width: 42, height: 42, borderRadius: "50%", flexShrink: 0,
                            background: "rgba(255,255,255,0.25)", color: "white",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 13, fontWeight: 800,
                          }}>{person.child[0]}{parentLastInitial}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 800, fontSize: 15, color: "white" }}>{person.child}</div>
                            <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.75)", marginTop: 2 }}>
                              {person.circleName} · {person.name}
                            </div>
                          </div>
                          <button onClick={() => setFriendProfilePopover(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.8)", fontSize: 20, lineHeight: 1, padding: 0, flexShrink: 0 }}>×</button>
                        </div>

                        {isVisible ? (
                          <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
                            {/* Age + zip */}
                            <div style={{ display: "flex", gap: 16 }}>
                              {prof.age && (
                                <div>
                                  <div style={{ fontSize: 10, fontWeight: 700, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 3 }}>Age</div>
                                  <div style={{ fontSize: 13, fontWeight: 700, color: "#1F2937" }}>{prof.age}</div>
                                </div>
                              )}
                              {prof.zipcode && (
                                <div>
                                  <div style={{ fontSize: 10, fontWeight: 700, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 3 }}>Zip</div>
                                  <div style={{ fontSize: 13, fontWeight: 700, color: "#1F2937" }}>{prof.zipcode}</div>
                                </div>
                              )}
                            </div>

                            {/* Bio */}
                            {prof.bio && (
                              <div style={{ fontSize: 12.5, color: "#374151", fontStyle: "italic", borderLeft: `3px solid ${person.circleColor}`, paddingLeft: 10 }}>
                                "{prof.bio}"
                              </div>
                            )}

                            {/* Interests */}
                            {(prof.interests?.length > 0) && (
                              <div>
                                <div style={{ fontSize: 10, fontWeight: 700, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>Interests</div>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                                  {(prof.interests || []).map(i => (
                                    <span key={i} style={{ fontSize: 11.5, background: "#F3F4F6", borderRadius: 6, padding: "3px 8px", color: "#374151", fontWeight: 500 }}>
                                      {INTEREST_MAP[i.toLowerCase()] || i}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Camps */}
                            {friendCamps.length > 0 && (
                              <div>
                                <div style={{ fontSize: 10, fontWeight: 700, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>This summer</div>
                                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                                  {friendCamps.map(c => (
                                    <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                      <div style={{ width: 7, height: 7, borderRadius: "50%", background: c.color, flexShrink: 0 }} />
                                      <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: 12, fontWeight: 600, color: "#1F2937", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</div>
                                        <div style={{ fontSize: 10.5, color: "#9CA3AF" }}>{c.dates} · {c.location}</div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div style={{ padding: "24px 16px", textAlign: "center" }}>
                            <div style={{ fontSize: 28, marginBottom: 8 }}>🔒</div>
                            <div style={{ fontSize: 13, fontWeight: 700, color: "#374151", marginBottom: 4 }}>Profile is private</div>
                            <div style={{ fontSize: 12, color: "#9CA3AF" }}>{person.child}'s parent hasn't made their profile visible yet.</div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </div>
            );
          })()}
          {activeTab === "camps" && (() => {
            const TYPE_CONFIG = {
              sports:   { label: "Sports",   emoji: "⚽" },
              art:      { label: "Art",       emoji: "🎨" },
              drama:    { label: "Drama",     emoji: "🎭" },
              outdoors: { label: "Outdoors",  emoji: "🌲" },
              language: { label: "Language",  emoji: "🌍" },
              classic:  { label: "Classic",   emoji: "🏕️" },
              stem:     { label: "STEM",      emoji: "🔬" },
              music:    { label: "Music",     emoji: "🎵" },
              gaming:   { label: "Gaming",    emoji: "🎮" },
            };
            const allCampPool = [...camps, ...airtableCamps, ...dynamicCamps];
            const allTypes = Object.keys(TYPE_CONFIG).filter(t => allCampPool.some(c => Array.isArray(c.campType) ? c.campType.includes(t) : c.campType === t));

            const filtered = allCampPool
              .filter(c => campTypeFilter.size === 0 || (Array.isArray(c.campType) ? c.campType.some(t => campTypeFilter.has(t)) : campTypeFilter.has(c.campType)))
              .slice()
              .sort((a, b) => {
                if (campSort === "name") return a.name.localeCompare(b.name);
                if (campSort === "type") { const at = Array.isArray(a.campType) ? a.campType[0] || "" : a.campType || ""; const bt = Array.isArray(b.campType) ? b.campType[0] || "" : b.campType || ""; return at.localeCompare(bt); }
                return a.week - b.week; // date
              });

            return (
              <div>
                {/* Filters row */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", flex: 1 }}>
                    <button
                      onClick={() => setCampTypeFilter(new Set())}
                      style={{
                        background: campTypeFilter.size === 0 ? "#3D6B1F" : "white",
                        color: campTypeFilter.size === 0 ? "white" : "#6B7280",
                        border: `1.5px solid ${campTypeFilter.size === 0 ? "#3D6B1F" : "#E5E7EB"}`,
                        borderRadius: 7, padding: "5px 12px",
                        fontFamily: "Inter, sans-serif", fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                      }}
                    >All</button>
                    {allTypes.map(t => (
                      <button key={t}
                        onClick={() => setCampTypeFilter(prev => { const next = new Set(prev); next.has(t) ? next.delete(t) : next.add(t); return next; })}
                        style={{
                          background: campTypeFilter.has(t) ? "#3D6B1F" : "white",
                          color: campTypeFilter.has(t) ? "white" : "#6B7280",
                          border: `1.5px solid ${campTypeFilter.has(t) ? "#3D6B1F" : "#E5E7EB"}`,
                          borderRadius: 7, padding: "5px 12px",
                          fontFamily: "Inter, sans-serif", fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                        }}
                      >{TYPE_CONFIG[t].emoji} {TYPE_CONFIG[t].label}</button>
                    ))}
                  </div>
                  {/* Sort */}
                  <div style={{ display: "flex", gap: 4, background: "#F3F4F6", borderRadius: 8, padding: 3 }}>
                    {[["date","Date"],["name","A–Z"],["type","Type"]].map(([val, lbl]) => (
                      <button key={val}
                        onClick={() => setCampSort(val)}
                        style={{
                          background: campSort === val ? "white" : "transparent",
                          border: "none", borderRadius: 6, padding: "4px 10px",
                          fontFamily: "Inter, sans-serif", fontSize: 12, fontWeight: 600,
                          color: campSort === val ? "#1F2937" : "#9CA3AF",
                          cursor: "pointer", boxShadow: campSort === val ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                        }}
                      >{lbl}</button>
                    ))}
                  </div>
                </div>

                {/* Camp list */}
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {filtered.map(camp => {
                    const campWeeks = (camp.weekRange || [camp.week]).map(wn => computedWeeks.find(w => w.num === wn)).filter(Boolean);
                    const friendsHere = liveCircles.flatMap(c => c.members).filter(m => m.camps.includes(camp.id));
                    const campTypes = Array.isArray(camp.campType) ? camp.campType : (camp.campType ? [camp.campType] : []); const typeConf = TYPE_CONFIG[campTypes[0]];
                    const isFocused = focusedCampId === camp.id;
                    const isExpanded = expandedCampId === camp.id;
                    const myKidsHere = kids.filter(k => campStatus[camp.id]?.[k.id]);

                    return (
                      <div key={camp.id}
                        ref={el => { if (isFocused && el) { el.scrollIntoView({ behavior: "smooth", block: "start" }); setTimeout(() => setFocusedCampId(null), 2000); } }}
                        style={{
                          background: "white",
                          border: isFocused ? `2px solid ${camp.color}` : "1px solid #E5E7EB",
                          borderLeft: `4px solid ${camp.color}`,
                          borderRadius: "var(--radius-lg)",
                          boxShadow: isFocused ? `0 0 0 3px ${camp.color}22, var(--shadow)` : "var(--shadow-sm)",
                          transition: "box-shadow 0.3s, border 0.3s",
                          overflow: "hidden",
                        }}
                      >
                        {/* Clickable summary row */}
                        <div
                          onClick={() => setExpandedCampId(isExpanded ? null : camp.id)}
                          style={{ padding: "14px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 12 }}
                        >
                          <div style={{ flex: 1, minWidth: 0 }}>
                            {/* Name + type badge */}
                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                              <span style={{ fontWeight: 700, fontSize: 14, color: "#1F2937" }}>{camp.name}</span>
                              {campTypes.map(t => TYPE_CONFIG[t]).filter(Boolean).map((tc, i) => (
                                <span key={i} style={{ fontSize: 11, fontWeight: 600, color: "#6B7280", background: "#F3F4F6", border: "1px solid #E5E7EB", borderRadius: 5, padding: "1px 7px" }}>
                                  {tc.emoji} {tc.label}
                                </span>
                              ))}
                            </div>
                            {/* Summary meta */}
                            <div style={{ fontSize: 12, color: "#9CA3AF", display: "flex", flexWrap: "wrap", gap: "2px 8px" }}>
                              <span>{camp.dates}</span>
                              <span>·</span>
                              <span>{camp.location}</span>
                              <span>·</span>
                              <span>{camp.hours}</span>
                              {camp.cost && <><span>·</span><span style={{ color: "#3D6B1F", fontWeight: 600 }}>${Number(camp.cost).toLocaleString()}</span></>}
                            </div>
                          </div>

                          {/* My kids status pills */}
                          <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
                            {myKidsHere.map(k => {
                              const s = campStatus[camp.id]?.[k.id];
                              const status = typeof s === "string" ? s : s?.status;
                              const color = status === "enrolled" ? "#3D6B1F" : status === "thinking" ? "#D97706" : "#9CA3AF";
                              const bg = status === "enrolled" ? "#eef5e8" : status === "thinking" ? "#FEF3C7" : "#F3F4F6";
                              return (
                                <span key={k.id} style={{ fontSize: 11, fontWeight: 700, color, background: bg, borderRadius: 6, padding: "2px 7px", display: "inline-flex", alignItems: "center", gap: 3 }}>
                                  <StatusIcon s={status} size={9} color={color} /> {k.name}
                                </span>
                              );
                            })}
                          </div>

                          {/* Expand chevron */}
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                            style={{ flexShrink: 0, transition: "transform 0.2s", transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)" }}>
                            <polyline points="6 9 12 15 18 9"/>
                          </svg>
                        </div>

                        {/* Expanded full details */}
                        {isExpanded && (
                          <div style={{ borderTop: "1px solid #F3F4F6", padding: "16px 16px 20px" }}>

                            {/* Full meta */}
                            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
                              {camp.address && (
                                <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                                  <div>
                                    <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(camp.address)}`} target="_blank" rel="noreferrer"
                                      style={{ fontSize: 12.5, color: "#374151", fontWeight: 500, textDecoration: "none" }}
                                      onMouseEnter={e => e.currentTarget.style.textDecoration = "underline"}
                                      onMouseLeave={e => e.currentTarget.style.textDecoration = "none"}
                                    >{camp.location}</a>
                                    <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 1 }}>{camp.address}</div>
                                  </div>
                                </div>
                              )}
                              {camp.hours && (
                                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                                  <span style={{ fontSize: 12.5, color: "#374151", fontWeight: 500 }}>{camp.hours}</span>
                                </div>
                              )}
                              {camp.beforeCare && (
                                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                  <span style={{ fontSize: 13, flexShrink: 0 }}>☀️</span>
                                  <div>
                                    <span style={{ fontSize: 12.5, color: "#374151", fontWeight: 500 }}>Before Care: {camp.beforeCare}</span>
                                    {camp.beforeCareCost && <span style={{ fontSize: 11.5, color: "#3D6B1F", fontWeight: 600, marginLeft: 8 }}>${Number(camp.beforeCareCost).toLocaleString()}</span>}
                                  </div>
                                </div>
                              )}
                              {camp.afterCare && (
                                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                  <span style={{ fontSize: 13, flexShrink: 0 }}>🌙</span>
                                  <div>
                                    <span style={{ fontSize: 12.5, color: "#374151", fontWeight: 500 }}>After Care: {camp.afterCare}</span>
                                    {camp.afterCareCost && <span style={{ fontSize: 11.5, color: "#3D6B1F", fontWeight: 600, marginLeft: 8 }}>${Number(camp.afterCareCost).toLocaleString()}</span>}
                                  </div>
                                </div>
                              )}
                              {camp.days && (
                                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                                  <div style={{ display: "flex", gap: 4 }}>
                                    {["M","T","W","Th","F"].map(d => (
                                      <span key={d} style={{
                                        width: 24, height: 24, borderRadius: 5, display: "inline-flex", alignItems: "center", justifyContent: "center",
                                        fontSize: 10.5, fontWeight: 700,
                                        background: camp.days.includes(d) ? camp.color + "22" : "#F3F4F6",
                                        color: camp.days.includes(d) ? camp.color : "#D1D5DB",
                                        border: `1px solid ${camp.days.includes(d) ? camp.color + "55" : "#E5E7EB"}`,
                                      }}>{d}</span>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {(camp.ageMin || camp.ageMax || camp.gradeMin || camp.gradeMax) && (
                                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
                                  <span style={{ fontSize: 12.5, color: "#374151", fontWeight: 500 }}>
                                    {camp.gradeMin || camp.gradeMax ? (camp.gradeMin && camp.gradeMax ? `Grades ${camp.gradeMin}–${camp.gradeMax}` : camp.gradeMin ? `Grade ${camp.gradeMin}+` : `Up to ${camp.gradeMax}`) : camp.ageMin && camp.ageMax ? `Ages ${camp.ageMin}–${camp.ageMax}` : camp.ageMin ? `Ages ${camp.ageMin}+` : `Up to age ${camp.ageMax}`}
                                  </span>
                                </div>
                              )}
                              {camp.cost && (
                                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                                  <span style={{ fontSize: 12.5, color: "#3D6B1F", fontWeight: 700 }}>${Number(camp.cost).toLocaleString()}</span>
                                </div>
                              )}
                              {camp.url && camp.url !== "#" && (
                                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                                  <a href={camp.url} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, color: camp.color, fontWeight: 500, textDecoration: "none" }}
                                    onMouseEnter={e => e.currentTarget.style.textDecoration = "underline"}
                                    onMouseLeave={e => e.currentTarget.style.textDecoration = "none"}
                                  >{camp.url.replace(/^https?:\/\//, "")}</a>
                                </div>
                              )}
                              {camp.discountCode && (
                                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
                                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <span style={{ fontSize: 12.5, color: "#374151", fontWeight: 500 }}>Discount code:</span>
                                    <span style={{ fontSize: 12.5, fontWeight: 700, color: "#3D6B1F", fontFamily: "monospace", background: "#eef5e8", border: "1px solid #c2d9b0", borderRadius: 5, padding: "2px 8px", letterSpacing: "0.05em" }}>{camp.discountCode}</span>
                                  </div>
                                </div>
                              )}
                              {camp.notes && (
                                <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 2 }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                                  <span style={{ fontSize: 12.5, color: "#374151", lineHeight: 1.5 }}>{camp.notes}</span>
                                </div>
                              )}
                            </div>

                            {/* Week × enrollments */}
                            {(() => {
                              const myKidBffIds = new Set(kids.flatMap(k => Array.from(getBffs(k.id))));
                              // Deduplicate by userId+child so people in multiple circles only appear once
                              const seenMemberKeys = new Set();
                              const allMembers = liveCircles.flatMap(c => c.members.map(m => ({
                                ...m, circleColor: c.color, isBff: m.userId ? myKidBffIds.has(m.userId) : false,
                                status: m.campStatus?.[camp.id] || 'enrolled',
                              }))).filter(m => {
                                if (!m.camps.includes(camp.id)) return false;
                                const key = (m.userId || m.id) + '-' + (m.child || '');
                                if (seenMemberKeys.has(key)) return false;
                                seenMemberKeys.add(key);
                                return true;
                              });
                              const myKidMembers = kids.map(k => {
                                const s = campStatus[camp.id]?.[k.id];
                                const status = s ? (typeof s === "string" ? s : s?.status) : null;
                                const weeks = s?.weeks || [];
                                if (!status) return null;
                                return { id: `kid-${k.id}`, name: k.name, child: k.name, initials: k.initials, isMyKid: true, status, weeks };
                              }).filter(Boolean);
                              const statusOrder = { enrolled: 0, thinking: 1, waitlist: 2 };
                              if (myKidMembers.length === 0 && allMembers.length === 0 && campWeeks.length <= 1) return null;
                              return (
                                <div>
                                  <div style={{ fontSize: 10.5, fontWeight: 700, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 10 }}>Who's going</div>
                                  <div style={{ display: "flex", gap: 0, overflowX: "auto" }}>
                                    {campWeeks.map((w, wi) => {
                                      // Filter my kids to only those enrolled this week
                                      const kidsThisWeek = myKidMembers.filter(m =>
                                        !m.weeks || m.weeks.length === 0 || m.weeks.includes(w.num)
                                      );
                                      const allPeopleThisWeek = [...kidsThisWeek, ...allMembers]
                                        .sort((a, b) => {
                                          if (a.isMyKid !== b.isMyKid) return a.isMyKid ? -1 : 1;
                                          if (a.isBff !== b.isBff) return a.isBff ? -1 : 1;
                                          return (statusOrder[a.status] ?? 3) - (statusOrder[b.status] ?? 3);
                                        });
                                      return (
                                        <div key={w.num} style={{ flex: "0 0 auto", minWidth: 100, borderLeft: wi > 0 ? "1px solid #F3F4F6" : "none", paddingLeft: wi > 0 ? 14 : 0, paddingRight: 14 }}>
                                          <div style={{ fontSize: 10, fontWeight: 700, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6, whiteSpace: "nowrap" }}>{w.dates}</div>
                                          <AvatarStack members={allPeopleThisWeek} />
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })()}

                            {/* Edit button - shown to everyone in the community */}
                            {(
                              <div style={{ marginTop: 12 }}>
                                {editCampId === camp.id ? (
                                  <div style={{ background: "#F9FAFB", borderRadius: 10, padding: "14px 16px", border: "1px solid #E5E7EB" }}>
                                    <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 12 }}>Edit Camp</div>
                                    {(() => {
                                      const TIMES = [];
                                      for (let h = 7; h <= 18; h++) {
                                        for (let m of [0, 30]) {
                                          if (h === 18 && m === 30) continue;
                                          const ampm = h < 12 ? "AM" : "PM";
                                          const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
                                          TIMES.push(`${h12}:${m === 0 ? "00" : "30"} ${ampm}`);
                                        }
                                      }
                                      const selStyle = { width: "100%", padding: "7px 10px", border: "1.5px solid #E5E7EB", borderRadius: 7, fontFamily: "Inter, sans-serif", fontSize: 13, color: "#1F2937", outline: "none", background: "white", appearance: "none" };
                                      const inStyle = { width: "100%", padding: "7px 10px", border: "1.5px solid #E5E7EB", borderRadius: 7, fontFamily: "Inter, sans-serif", fontSize: 13, color: "#1F2937", outline: "none" };
                                      const lbl = (t) => <label style={{ fontSize: 11, fontWeight: 600, color: "#6B7280", display: "block", marginBottom: 4 }}>{t}</label>;
                                      const ef = editForm || {};
                                      const upd = (k, v) => setEditForm(prev => ({ ...prev, [k]: v }));
                                      const GRADES = ["Pre-K","K","1st","2nd","3rd","4th","5th","6th","7th","8th","9th","10th","11th","12th"];
                                      const TYPES = [{ value:"sports",label:"⚽ Sports"},{ value:"art",label:"🎨 Art"},{ value:"drama",label:"🎭 Drama"},{ value:"outdoors",label:"🌲 Outdoors"},{ value:"language",label:"🌍 Language"},{ value:"classic",label:"🏕️ Classic"},{ value:"stem",label:"🔬 STEM"},{ value:"music",label:"🎵 Music"},{ value:"academics",label:"📚 Academics"},{ value:"gaming",label:"🎮 Gaming"}];
                                      const curTypes = Array.isArray(ef.campType) ? ef.campType : (ef.campType ? [ef.campType] : []);
                                      return (
                                        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                                          {/* Camp Name */}
                                          <div>{lbl("Camp Name")}<input style={inStyle} value={ef.name||""} onChange={e=>upd("name",e.target.value)} onFocus={e=>e.target.style.borderColor="#3D6B1F"} onBlur={e=>e.target.style.borderColor="#E5E7EB"} /></div>
                                          {/* Type */}
                                          <div>{lbl("Type")}
                                            <div style={{display:"flex",gap:5,flexWrap:"wrap",marginTop:4}}>
                                              {TYPES.map(t => {
                                                const on = curTypes.includes(t.value);
                                                return <button key={t.value} onClick={()=>upd("campType",on?curTypes.filter(x=>x!==t.value):[...curTypes,t.value])} style={{padding:"5px 10px",borderRadius:7,border:`1.5px solid ${on?"#3D6B1F":"#E5E7EB"}`,background:on?"#3D6B1F":"white",color:on?"white":"#374151",fontFamily:"Inter,sans-serif",fontSize:12,fontWeight:500,cursor:"pointer"}}>{t.label}</button>;
                                              })}
                                            </div>
                                          </div>
                                          {/* Website URL */}
                                          <div>{lbl("Website URL")}<input style={inStyle} value={ef.url||""} onChange={e=>upd("url",e.target.value)} onFocus={e=>e.target.style.borderColor="#3D6B1F"} onBlur={e=>e.target.style.borderColor="#E5E7EB"} /></div>
                                          {/* Dates */}
                                          <div style={{ display:"flex", gap:8 }}>
                                            <div style={{flex:1}}>{lbl("Start Date")}<input type="date" style={inStyle} value={ef.dateStart||""} onChange={e=>upd("dateStart",e.target.value)} /></div>
                                            <div style={{flex:1}}>{lbl("End Date")}<input type="date" style={inStyle} value={ef.dateEnd||""} onChange={e=>upd("dateEnd",e.target.value)} /></div>
                                          </div>
                                          {/* Location / Address */}
                                          <div style={{display:"flex",gap:8}}>
                                            <div style={{flex:1}}>{lbl("Neighborhood / City")}<input style={inStyle} placeholder="e.g. Malibu Creek" value={ef.location||""} onChange={e=>upd("location",e.target.value)} onFocus={e=>e.target.style.borderColor="#3D6B1F"} onBlur={e=>e.target.style.borderColor="#E5E7EB"} /></div>
                                            <div style={{flex:1}}>{lbl("Full Address")}<input style={inStyle} placeholder="e.g. 1900 Las Virgenes Rd" value={ef.address||""} onChange={e=>upd("address",e.target.value)} onFocus={e=>e.target.style.borderColor="#3D6B1F"} onBlur={e=>e.target.style.borderColor="#E5E7EB"} /></div>
                                          </div>
                                          {/* Camp Hours */}
                                          <div>{lbl("Camp Hours")}
                                            <div style={{display:"flex",gap:8,alignItems:"center",marginTop:4}}>
                                              <select style={selStyle} value={ef.timeStart||""} onChange={e=>upd("timeStart",e.target.value)}><option value="">Start time</option>{TIMES.map(t=><option key={t} value={t}>{t}</option>)}</select>
                                              <span style={{color:"#9CA3AF",flexShrink:0}}>to</span>
                                              <select style={selStyle} value={ef.timeEnd||""} onChange={e=>upd("timeEnd",e.target.value)}><option value="">End time</option>{TIMES.map(t=><option key={t} value={t}>{t}</option>)}</select>
                                            </div>
                                          </div>
                                          {/* Cost */}
                                          <div style={{position:"relative"}}>{lbl("Cost")} <span style={{fontSize:10,fontWeight:400,color:"#9CA3AF"}}>optional</span><span style={{position:"absolute",left:9,bottom:8,color:"#9CA3AF"}}>$</span><input style={{...inStyle,paddingLeft:22}} type="number" placeholder="0" value={ef.cost||""} onChange={e=>upd("cost",e.target.value)} /></div>
                                          {/* Before Care */}
                                          <div>{lbl("Before Care")} <span style={{fontSize:10,fontWeight:400,color:"#9CA3AF"}}>optional</span>
                                            <div style={{display:"flex",gap:4,alignItems:"center",marginTop:4}}>
                                              <select style={selStyle} value={ef.beforeCareStart||""} onChange={e=>upd("beforeCareStart",e.target.value)}><option value="">Start</option>{TIMES.map(t=><option key={t} value={t}>{t}</option>)}</select>
                                              <span style={{color:"#9CA3AF",flexShrink:0}}>–</span>
                                              <select style={selStyle} value={ef.beforeCareEnd||""} onChange={e=>upd("beforeCareEnd",e.target.value)}><option value="">End</option>{TIMES.map(t=><option key={t} value={t}>{t}</option>)}</select>
                                            </div>
                                            {(ef.beforeCareStart||ef.beforeCareEnd) && <div style={{position:"relative",marginTop:4}}><span style={{position:"absolute",left:9,top:"50%",transform:"translateY(-50%)",color:"#9CA3AF"}}>$</span><input style={{...inStyle,paddingLeft:22}} type="number" placeholder="Before care cost (optional)" value={ef.beforeCareCost||""} onChange={e=>upd("beforeCareCost",e.target.value)} /></div>}
                                          </div>
                                          {/* After Care */}
                                          <div>{lbl("After Care")} <span style={{fontSize:10,fontWeight:400,color:"#9CA3AF"}}>optional</span>
                                            <div style={{display:"flex",gap:4,alignItems:"center",marginTop:4}}>
                                              <select style={selStyle} value={ef.afterCareStart||""} onChange={e=>upd("afterCareStart",e.target.value)}><option value="">Start</option>{TIMES.map(t=><option key={t} value={t}>{t}</option>)}</select>
                                              <span style={{color:"#9CA3AF",flexShrink:0}}>–</span>
                                              <select style={selStyle} value={ef.afterCareEnd||""} onChange={e=>upd("afterCareEnd",e.target.value)}><option value="">End</option>{TIMES.map(t=><option key={t} value={t}>{t}</option>)}</select>
                                            </div>
                                            {(ef.afterCareStart||ef.afterCareEnd) && <div style={{position:"relative",marginTop:4}}><span style={{position:"absolute",left:9,top:"50%",transform:"translateY(-50%)",color:"#9CA3AF"}}>$</span><input style={{...inStyle,paddingLeft:22}} type="number" placeholder="After care cost (optional)" value={ef.afterCareCost||""} onChange={e=>upd("afterCareCost",e.target.value)} /></div>}
                                          </div>
                                          {/* Discount Code */}
                                          <div>{lbl("Discount Code")} <span style={{fontSize:10,fontWeight:400,color:"#9CA3AF"}}>optional</span><input style={{...inStyle,fontFamily:"monospace",textTransform:"uppercase",marginTop:4}} placeholder="e.g. SUMMER25" value={ef.discountCode||""} onChange={e=>upd("discountCode",e.target.value)} /></div>
                                          {/* Notes */}
                                          <div>{lbl("Notes")} <span style={{fontSize:10,fontWeight:400,color:"#9CA3AF"}}>optional</span><textarea rows={2} style={{...inStyle,resize:"vertical",marginTop:4}} placeholder="e.g. Bring sunscreen, pick up at side gate..." value={ef.notes||""} onChange={e=>upd("notes",e.target.value)} /></div>
                                          {/* Age / Grade Range */}
                                          <div>
                                            {lbl("Age / Grade Range")} <span style={{fontSize:10,fontWeight:400,color:"#9CA3AF"}}>optional</span>
                                            <div style={{display:"flex",gap:0,background:"#F3F4F6",borderRadius:8,padding:3,width:"fit-content",margin:"6px 0 8px"}}>
                                              {[["age","By Age"],["grade","By Grade"]].map(([val,lbl2]) => (
                                                <button key={val} onClick={()=>upd("ageOrGrade",val)} style={{background:ef.ageOrGrade===val?"white":"transparent",border:"none",borderRadius:6,padding:"5px 14px",fontFamily:"Inter,sans-serif",fontSize:12.5,fontWeight:600,color:ef.ageOrGrade===val?"#1F2937":"#9CA3AF",cursor:"pointer",boxShadow:ef.ageOrGrade===val?"0 1px 3px rgba(0,0,0,0.1)":"none",transition:"all 0.12s"}}>{lbl2}</button>
                                              ))}
                                            </div>
                                            <div style={{display:"flex",alignItems:"center",gap:10}}>
                                              {ef.ageOrGrade === "grade" ? (
                                                <>
                                                  <select style={selStyle} value={ef.gradeMin||""} onChange={e=>upd("gradeMin",e.target.value)}><option value="">Min grade</option>{["Pre-K","K","1st","2nd","3rd","4th","5th","6th","7th","8th","9th","10th","11th","12th"].map(g=><option key={g} value={g}>{g}</option>)}</select>
                                                  <span style={{color:"#9CA3AF",fontSize:13,flexShrink:0}}>to</span>
                                                  <select style={selStyle} value={ef.gradeMax||""} onChange={e=>upd("gradeMax",e.target.value)}><option value="">Max grade</option>{["Pre-K","K","1st","2nd","3rd","4th","5th","6th","7th","8th","9th","10th","11th","12th"].map(g=><option key={g} value={g}>{g}</option>)}</select>
                                                </>
                                              ) : (
                                                <>
                                                  <select style={selStyle} value={ef.ageMin||""} onChange={e=>upd("ageMin",e.target.value)}><option value="">Min age</option>{Array.from({length:17},(_,i)=>i+2).map(a=><option key={a} value={a}>{a} years</option>)}</select>
                                                  <span style={{color:"#9CA3AF",fontSize:13,flexShrink:0}}>to</span>
                                                  <select style={selStyle} value={ef.ageMax||""} onChange={e=>upd("ageMax",e.target.value)}><option value="">Max age</option>{Array.from({length:17},(_,i)=>i+2).map(a=><option key={a} value={a}>{a} years</option>)}</select>
                                                </>
                                              )}
                                            </div>
                                          </div>
                                          {/* Days */}
                                          <div>{lbl("Days camp runs")}
                                            <div style={{fontSize:11.5,color:"#9CA3AF",margin:"3px 0 6px"}}>Which days of the week does this camp meet?</div>
                                            <div style={{display:"flex",gap:5}}>
                                              {["M","T","W","Th","F"].map(d => {
                                                const days = ef.days||[];
                                                const on = days.includes(d);
                                                return <button key={d} onClick={()=>upd("days",on?days.filter(x=>x!==d):[...days,d])} style={{width:32,height:32,borderRadius:6,border:`1.5px solid ${on?"#3D6B1F":"#E5E7EB"}`,background:on?"#3D6B1F":"white",color:on?"white":"#9CA3AF",fontFamily:"Inter,sans-serif",fontSize:11,fontWeight:700,cursor:"pointer"}}>{d}</button>;
                                              })}
                                            </div>
                                          </div>
                                        </div>
                                      );
                                    })()}
                                    <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                                      <button
                                        onClick={async () => {
                                          console.log('Saving camp:', camp.id, editForm);
                                          const result = await updateCamp(camp.id, editForm).catch(e => console.error('updateCamp error:', e));
                                          console.log('updateCamp result:', result);
                                          // Update local camp data
                                          const getMon = (ds) => { const d = new Date(ds+"T12:00:00"); const dow=d.getDay(); d.setDate(d.getDate()-(dow===0?6:dow-1)); return d.toISOString().slice(0,10); };
                                          const fmt = (ds) => { if(!ds) return ""; const d=new Date(ds+"T12:00:00"); return d.toLocaleDateString("en-US",{month:"short",day:"numeric"}); };
                                          const dates = editForm.dateStart && editForm.dateEnd ? fmt(editForm.dateStart)+" - "+fmt(editForm.dateEnd) : fmt(editForm.dateStart||camp.dateStart);
                                          const hours = editForm.timeStart && editForm.timeEnd ? editForm.timeStart+" - "+editForm.timeEnd : camp.hours;
                                          const beforeCare = editForm.beforeCareStart && editForm.beforeCareEnd ? editForm.beforeCareStart+" - "+editForm.beforeCareEnd : camp.beforeCare;
                                          const afterCare = editForm.afterCareStart && editForm.afterCareEnd ? editForm.afterCareStart+" - "+editForm.afterCareEnd : camp.afterCare;
                                          setAirtableCamps(prev => prev.map(c => c.id === camp.id ? { ...c, ...editForm, dates, hours, beforeCare, afterCare } : c));
                                          setEditCampId(null); setEditForm(null);
                                        }}
                                        style={{ background: "#3D6B1F", border: "none", borderRadius: 7, padding: "7px 16px", fontFamily: "Inter, sans-serif", fontSize: 13, fontWeight: 700, color: "white", cursor: "pointer" }}
                                      >Save</button>
                                      <button onClick={() => { setEditCampId(null); setEditForm(null); }} style={{ background: "none", border: "1px solid #E5E7EB", borderRadius: 7, padding: "7px 14px", fontFamily: "Inter, sans-serif", fontSize: 13, fontWeight: 500, color: "#6B7280", cursor: "pointer" }}>Cancel</button>
                                    </div>
                                  </div>
                                ) : (
                                  <div style={{ display: "flex", gap: 6 }}>
                                    <button
                                      onClick={() => {
                                        setEditCampId(camp.id);
                                        setEditForm({
                                          name: camp.name || "",
                                          dateStart: camp.dateStart || "",
                                          dateEnd: camp.dateEnd || "",
                                          timeStart: camp.hours ? camp.hours.split(" - ")[0] : "",
                                          timeEnd: camp.hours ? camp.hours.split(" - ")[1] : "",
                                          beforeCareStart: camp.beforeCare ? camp.beforeCare.split(" - ")[0] : "",
                                          beforeCareEnd: camp.beforeCare ? camp.beforeCare.split(" - ")[1] : "",
                                          beforeCareCost: camp.beforeCareCost || "",
                                          afterCareStart: camp.afterCare ? camp.afterCare.split(" - ")[0] : "",
                                          afterCareEnd: camp.afterCare ? camp.afterCare.split(" - ")[1] : "",
                                          afterCareCost: camp.afterCareCost || "",
                                          days: camp.days || [],
                                          campType: Array.isArray(camp.campType) ? camp.campType : (camp.campType ? [camp.campType] : []),
                                          ageOrGrade: camp.gradeMin || camp.gradeMax ? "grade" : "age",
                                          ageMin: camp.ageMin || "",
                                          ageMax: camp.ageMax || "",
                                          gradeMin: camp.gradeMin || "",
                                          gradeMax: camp.gradeMax || "",
                                          location: camp.location || "",
                                          address: camp.address || "",
                                          url: camp.url || "",
                                          cost: camp.cost || "",
                                          discountCode: camp.discountCode || "",
                                          notes: camp.notes || "",
                                        });
                                      }}
                                      style={{ background: "none", border: "1px solid #E5E7EB", borderRadius: 7, padding: "6px 12px", fontFamily: "Inter, sans-serif", fontSize: 12, fontWeight: 600, color: "#6B7280", cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}
                                    >
                                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                      Edit camp
                                    </button>
                                    <button
                                      onClick={() => {
                                        setManualForm({
                                          name: camp.name + " (copy)",
                                          dateStart: camp.dateStart || "",
                                          dateEnd: camp.dateEnd || "",
                                          timeStart: camp.hours ? camp.hours.split(" - ")[0] : "",
                                          timeEnd: camp.hours ? camp.hours.split(" - ")[1] : "",
                                          beforeCareStart: camp.beforeCare ? camp.beforeCare.split(" - ")[0] : "",
                                          beforeCareEnd: camp.beforeCare ? camp.beforeCare.split(" - ")[1] : "",
                                          beforeCareCost: camp.beforeCareCost ? String(camp.beforeCareCost) : "",
                                          afterCareStart: camp.afterCare ? camp.afterCare.split(" - ")[0] : "",
                                          afterCareEnd: camp.afterCare ? camp.afterCare.split(" - ")[1] : "",
                                          afterCareCost: camp.afterCareCost ? String(camp.afterCareCost) : "",
                                          days: camp.days || [],
                                          campType: Array.isArray(camp.campType) ? camp.campType : (camp.campType ? [camp.campType] : []),
                                          ageOrGrade: camp.gradeMin || camp.gradeMax ? "grade" : "age",
                                          ageMin: camp.ageMin ? String(camp.ageMin) : "",
                                          ageMax: camp.ageMax ? String(camp.ageMax) : "",
                                          gradeMin: camp.gradeMin || "",
                                          gradeMax: camp.gradeMax || "",
                                          location: camp.location || "",
                                          address: camp.address || "",
                                          url: camp.url || "",
                                          cost: camp.cost ? String(camp.cost) : "",
                                          discountCode: "",
                                          notes: "",
                                        });
                                        setActiveTab("import");
                                        setExpandedCampId(null);
                                      }}
                                      style={{ background: "none", border: "1px solid #E5E7EB", borderRadius: 7, padding: "6px 12px", fontFamily: "Inter, sans-serif", fontSize: 12, fontWeight: 600, color: "#6B7280", cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}
                                      title="Duplicate this camp to create a similar one"
                                    >
                                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                                      Duplicate
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Action buttons - one per kid */}
                            <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                              {kids.map(kid => {
                                const s = campStatus[camp.id]?.[kid.id];
                                const status = s ? (typeof s === "string" ? s : s?.status) : null;
                                const statusColor = status === "enrolled" ? "#3D6B1F" : status === "thinking" ? "#D97706" : "#9CA3AF";
                                const statusBg = status === "enrolled" ? "#eef5e8" : status === "thinking" ? "#FEF3C7" : "#F3F4F6";
                                const isPickerOpen = campStatusPicker?.campId === camp.id && campStatusPicker?.kidId === kid.id;
                                return (
                                  <div key={kid.id} style={{ position: "relative" }}>
                                    {status ? (
                                      <button
                                        onClick={() => setCampStatusPicker(isPickerOpen ? null : { campId: camp.id, kidId: kid.id })}
                                        style={{
                                          background: statusBg, border: `1.5px solid ${statusColor}55`,
                                          borderRadius: 8, padding: "7px 14px",
                                          fontFamily: "Inter, sans-serif", fontSize: 13, fontWeight: 700,
                                          color: statusColor, cursor: "pointer",
                                          display: "flex", alignItems: "center", gap: 6,
                                        }}
                                      >
                                        <StatusIcon s={status} size={11} color={statusColor} />
                                        {kid.name} - {STATUS_CONFIG[status]?.label}
                                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={statusColor} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 2 }}><polyline points="6 9 12 15 18 9"/></svg>
                                      </button>
                                    ) : (
                                      <button
                                        onClick={() => openEnrollModal(camp.id, kid.id, "enrolled", camp.days)}
                                        style={{
                                          background: "#3D6B1F", border: "none", borderRadius: 8,
                                          padding: "7px 14px", fontFamily: "Inter, sans-serif",
                                          fontSize: 13, fontWeight: 700, color: "white", cursor: "pointer",
                                          display: "flex", alignItems: "center", gap: 6,
                                        }}
                                      >
                                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                                        Add {kid.name}
                                      </button>
                                    )}
                                    {/* Inline status picker dropdown */}
                                    {isPickerOpen && (
                                      <div style={{
                                        position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 200,
                                        background: "white", borderRadius: 10, border: "1px solid #E5E7EB",
                                        boxShadow: "0 8px 24px rgba(0,0,0,0.12)", overflow: "hidden", minWidth: 180,
                                      }}>
                                        {["enrolled","thinking","waitlist"].map(s => (
                                          <button key={s}
                                            onClick={() => { setStatus(camp.id, kid.id, s); setCampStatusPicker(null); }}
                                            style={{
                                              width: "100%", textAlign: "left", background: status === s ? STATUS_CONFIG[s].light : "none",
                                              border: "none", padding: "9px 14px", cursor: "pointer",
                                              fontFamily: "Inter, sans-serif", fontSize: 13, fontWeight: status === s ? 700 : 500,
                                              color: STATUS_CONFIG[s].bg,
                                              display: "flex", alignItems: "center", gap: 8,
                                              borderBottom: "1px solid #F3F4F6",
                                            }}
                                            onMouseEnter={e => e.currentTarget.style.background = STATUS_CONFIG[s].light}
                                            onMouseLeave={e => e.currentTarget.style.background = status === s ? STATUS_CONFIG[s].light : "none"}
                                          >
                                            <StatusIcon s={s} size={12} color={STATUS_CONFIG[s].bg} />
                                            {STATUS_CONFIG[s].label}
                                            {status === s && <span style={{ marginLeft: "auto", fontSize: 11 }}>✓</span>}
                                          </button>
                                        ))}
                                        <button
                                          onClick={() => { removeStatus(camp.id, kid.id); setCampStatusPicker(null); }}
                                          style={{
                                            width: "100%", textAlign: "left", background: "none",
                                            border: "none", padding: "9px 14px", cursor: "pointer",
                                            fontFamily: "Inter, sans-serif", fontSize: 12.5, fontWeight: 500,
                                            color: "#DC2626", display: "flex", alignItems: "center", gap: 8,
                                          }}
                                          onMouseEnter={e => e.currentTarget.style.background = "#FEF2F2"}
                                          onMouseLeave={e => e.currentTarget.style.background = "none"}
                                        >
                                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                                          Remove from camp
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                              {friendsHere.length > 0 && (
                                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#6B7280" }}>
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                                  {friendsHere.map(f => f.child).join(", ")} also going
                                </div>
                              )}
                            </div>

                            {/* Reviews section */}
                            {(() => {
                              // Show reviews from yourself or anyone in your circles
                              const circleUserIds = new Set([
                                userId,
                                ...liveCircles.flatMap(c => c.members.map(m => m.userId))
                              ]);
                              const visibleReviews = (campReviews[camp.id] || []).filter(r =>
                                circleUserIds.has(r.userId)
                              );
                              const draft = reviewDraft[camp.id] || { rating: 0, text: "" };
                              const isWriting = showReviewForm === camp.id;

                              const StarRow = ({ value, onChange }) => (
                                <div style={{ display: "flex", gap: 2 }}>
                                  {[1,2,3,4,5].map(n => (
                                    <button key={n}
                                      onClick={() => onChange(n)}
                                      style={{ background: "none", border: "none", cursor: "pointer", padding: 2, fontSize: 20, lineHeight: 1, color: n <= value ? "#F59E0B" : "#E5E7EB", transition: "color 0.1s" }}
                                    >★</button>
                                  ))}
                                </div>
                              );

                              return (
                                <div style={{ borderTop: "1px solid #F3F4F6", marginTop: 16, paddingTop: 16 }}>
                                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                      <span style={{ fontSize: 12, fontWeight: 700, color: "#374151" }}>Circle Reviews</span>
                                      <span style={{ fontSize: 11, color: "#9CA3AF" }}>Only visible to your circles</span>
                                    </div>
                                    {!isWriting && (
                                      <button
                                        onClick={() => setShowReviewForm(camp.id)}
                                        style={{
                                          background: "none", border: "1.5px solid #E5E7EB", borderRadius: 7,
                                          padding: "4px 10px", fontFamily: "Inter, sans-serif",
                                          fontSize: 12, fontWeight: 600, color: "#374151", cursor: "pointer",
                                        }}
                                      >+ Write a review</button>
                                    )}
                                  </div>

                                  {/* Write review form */}
                                  {isWriting && (
                                    <div style={{ background: "#F9FAFB", borderRadius: 10, padding: "12px 14px", marginBottom: 14, border: "1px solid #E5E7EB" }}>
                                      <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 8 }}>Your review</div>
                                      <StarRow value={draft.rating} onChange={v => setReviewDraft(prev => ({ ...prev, [camp.id]: { ...draft, rating: v } }))} />
                                      <textarea
                                        placeholder="What did your kid think? Any tips for other parents..."
                                        value={draft.text}
                                        onChange={e => setReviewDraft(prev => ({ ...prev, [camp.id]: { ...draft, text: e.target.value } }))}
                                        rows={3}
                                        style={{
                                          width: "100%", marginTop: 8, padding: "8px 10px",
                                          border: "1.5px solid #E5E7EB", borderRadius: 7,
                                          fontFamily: "Inter, sans-serif", fontSize: 13, color: "#1F2937",
                                          resize: "vertical", outline: "none", boxSizing: "border-box",
                                        }}
                                        onFocus={e => e.target.style.borderColor = "#3D6B1F"}
                                        onBlur={e => e.target.style.borderColor = "#E5E7EB"}
                                      />
                                      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                                        <button
                                          disabled={!draft.rating || !draft.text.trim()}
                                          onClick={async () => {
                                            if (!draft.rating || !draft.text.trim()) return;
                                            const authorChild = (profileKidId ? kids.find(k => k.id === profileKidId)?.name : kids[0]?.name) || kids[0]?.name || "";
                                            try {
                                              const saved = await saveReview(camp.id, userId, parentName || userName, authorChild, draft.rating, draft.text.trim());
                                              setCampReviews(prev => ({ ...prev, [camp.id]: [saved, ...(prev[camp.id] || [])] }));
                                              setReviewDraft(prev => ({ ...prev, [camp.id]: { rating: 0, text: "" } }));
                                              setShowReviewForm(null);
                                            } catch(e) {
                                              console.error("saveReview error:", e);
                                            }
                                          }}
                                          style={{
                                            background: "#3D6B1F", border: "none", borderRadius: 7,
                                            padding: "6px 14px", fontFamily: "Inter, sans-serif",
                                            fontSize: 12, fontWeight: 700, color: "white",
                                            cursor: draft.rating && draft.text.trim() ? "pointer" : "not-allowed",
                                            opacity: draft.rating && draft.text.trim() ? 1 : 0.4,
                                          }}
                                        >Post review</button>
                                        <button
                                          onClick={() => setShowReviewForm(null)}
                                          style={{ background: "none", border: "none", fontFamily: "Inter, sans-serif", fontSize: 12, fontWeight: 600, color: "#9CA3AF", cursor: "pointer" }}
                                        >Cancel</button>
                                      </div>
                                    </div>
                                  )}

                                  {/* Existing reviews */}
                                  {visibleReviews.length === 0 && !isWriting ? (
                                    <div style={{ fontSize: 12.5, color: "#9CA3AF", fontStyle: "italic", textAlign: "center", padding: "12px 0" }}>
                                      No reviews yet from your circles. Be the first!
                                    </div>
                                  ) : (
                                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                                      {visibleReviews.map(review => (
                                        <div key={review.id} style={{ borderBottom: "1px solid #F3F4F6", paddingBottom: 12 }}>
                                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                                            <div style={{ width: 26, height: 26, borderRadius: "50%", background: "#3D6B1F", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800, flexShrink: 0 }}>
                                              {review.authorName[0]}{review.authorName.split(" ")[1]?.[0] || ""}
                                            </div>
                                            <div style={{ flex: 1 }}>
                                              <div style={{ fontSize: 12.5, fontWeight: 700, color: "#1F2937" }}>
                                                {review.authorName}
                                                <span style={{ fontSize: 11, color: "#9CA3AF", fontWeight: 400, marginLeft: 6 }}>parent of {review.authorChild}</span>
                                              </div>
                                              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                                <span style={{ color: "#F59E0B", fontSize: 12 }}>{"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}</span>
                                                <span style={{ fontSize: 10.5, color: "#9CA3AF" }}>{new Date(review.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                                              </div>
                                            </div>
                                          </div>
                                          <p style={{ fontSize: 12.5, color: "#374151", lineHeight: 1.6, margin: 0, paddingLeft: 34 }}>{review.text}</p>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {filtered.length === 0 && (
                    <div style={{ textAlign: "center", padding: "40px 0", color: "#9CA3AF", fontSize: 14 }}>
                      No camps match this filter
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* ── WEEKLY TAB ── */}
          {activeTab === "weekly" && (
            <>
              {/* Filter bar */}
              <div className="filter-bar">
                <div className="filter-row">
                  {kids.map((kid) => (
                    <button
                      key={kid.id}
                      className="sibling-toggle"
                      style={{
                        background: selectedKids.has(kid.id) ? "#3D6B1F" : "white",
                        color: selectedKids.has(kid.id) ? "white" : "#3D6B1F",
                        borderColor: "#3D6B1F",
                      }}
                      onClick={() => toggleKid(kid.id)}
                    >
                      <span className="sibling-initials-bubble" style={{
                        background: selectedKids.has(kid.id) ? "rgba(255,255,255,0.25)" : "#dcefd0",
                        color: selectedKids.has(kid.id) ? "white" : "#3D6B1F",
                      }}>{kid.initials}</span>
                      {kid.name}
                    </button>
                  ))}
                </div>
                <div className="filter-row">
                  <button
                    className={`circle-pill ${selectedCircles.size === 0 ? "active" : ""}`}
                    style={selectedCircles.size === 0 ? { background: "#3D6B1F", borderColor: "#3D6B1F" } : { borderColor: "#ddd" }}
                    onClick={() => setSelectedCircles(new Set())}
                  >
                    All Circles
                  </button>
                  {liveCircles.map((c) => (
                    <button
                      key={c.id}
                      className={`circle-pill ${selectedCircles.has(c.id) ? "active" : ""}`}
                      style={
                        selectedCircles.has(c.id)
                          ? { background: "#3D6B1F", borderColor: "#3D6B1F" }
                          : { borderColor: "#3D6B1F", color: "#3D6B1F" }
                      }
                      onClick={() => toggleCircle(c.id)}
                    >
                      {c.emoji} {c.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* All weeks scrollable */}
              {computedWeeks.map((w) => {
                // Compute friend density for this week (used in header)
                const allFriendMembers = liveCircles.flatMap(c => c.members);
                const friendDensity = new Set(
                  allFriendMembers.flatMap(m =>
                    m.camps.filter(cid => {
                      const campPool0 = [...camps, ...airtableCamps, ...dynamicCamps];
                      const c = campPool0.find(x => x.id === cid);
                      return c && campInWeek(c, w.num);
                    }).map(cid => m.id + "-" + cid)
                  )
                ).size;
                // friendDensity = number of friend-camp pairings this week (proxy for busyness)
                const densityCount = new Set(
                  allFriendMembers.filter(m =>
                    m.camps.some(cid => {
                      const campPool0 = [...camps, ...airtableCamps, ...dynamicCamps];
                      const c = campPool0.find(x => x.id === cid);
                      return c && campInWeek(c, w.num);
                    })
                  ).map(m => m.id)
                ).size; // unique friends active this week
              return (() => {
                const myKidsCampsThisWeek = kids.filter(kid => selectedKids.has(kid.id)).flatMap((kid) => {
                  const enrolledCampIds = Object.entries(campStatus)
                    .filter(([, kidMap]) => kidMap[kid.id] && (typeof kidMap[kid.id] === "string" ? kidMap[kid.id] : kidMap[kid.id]?.status))
                    .map(([cid]) => cid);
                  const campPool = [...camps, ...airtableCamps, ...dynamicCamps];
                  return enrolledCampIds
                    .map((cid) => campPool.find((c) => c.id === cid))
                    .filter((c) => c && campInWeek(c, w.num))
                    .map((c) => {
                      const enrollment = getKidEnrollment(c.id, kid.id);
                      return { ...c, kidName: kid.name, kidInitials: kid.initials, kidId: kid.id,
                        status: enrollment?.status, enrollment };
                    });
                });

                const friendMembers = selectedCircles.size > 0
                  ? liveCircles.filter(c => selectedCircles.has(c.id)).flatMap(c => c.members)
                  : liveCircles.flatMap((c) => c.members);
                const friendCampsThisWeek = {};
                friendMembers.forEach((m) => {
                  m.camps.forEach((cid) => {
                    const campPool2 = [...camps, ...airtableCamps, ...dynamicCamps];
                    const camp = campPool2.find((c) => c.id === cid);
                    if (!camp || !campInWeek(camp, w.num)) return;
                              const initials = m.child[0] + lastName;
                    if (!friendCampsThisWeek[cid]) friendCampsThisWeek[cid] = { ...camp, friends: [] };
                    if (!friendCampsThisWeek[cid].friends.find(f => f.name === m.child)) {
                      // Simulate friend status: member id %3 for variety
                      const friendStatus = m.id % 3 === 0 ? "waitlist" : m.id % 3 === 2 ? "thinking" : "enrolled";
                      friendCampsThisWeek[cid].friends.push({ name: m.child, initials, status: friendStatus });
                    }
                  });
                });

                // BFF circle id
                const bffCircle = liveCircles.find(c => c.name === "BFFs");
                const bffMemberIds = new Set(bffCircle ? bffCircle.members.map(m => m.id) : []);

                const allCampIds = new Set([
                  ...myKidsCampsThisWeek.map(c => c.id),
                  ...Object.keys(friendCampsThisWeek)
                ]);

                // Sort: my kids first, then BFF circle, then rest
                const allCampPool = [...camps, ...airtableCamps, ...dynamicCamps];
                const allCamps = [...allCampIds].map(id => allCampPool.find(c => c.id === id)).filter(Boolean);
                const myKidsCampIds = new Set(myKidsCampsThisWeek.map(c => c.id));
                const bffCampIds = new Set(
                  bffCircle
                    ? bffCircle.members.flatMap(m => m.camps.filter(cid => {
                        const c = camps.find(x => x.id === cid);
                        return c && campInWeek(c, w.num);
                      }))
                    : []
                );
                allCamps.sort((a, b) => {
                  const scoreA = myKidsCampIds.has(a.id) ? 0 : bffCampIds.has(a.id) ? 1 : 2;
                  const scoreB = myKidsCampIds.has(b.id) ? 0 : bffCampIds.has(b.id) ? 1 : 2;
                  return scoreA - scoreB;
                });

                const isExpanded = expandedWeeks.has(w.num);
                const LIMIT = 3;
                const visibleCamps = isExpanded ? allCamps : allCamps.slice(0, LIMIT);
                const hiddenCount = allCamps.length - LIMIT;

                const isBreakWeek = kids.some(kid => selectedKids.has(kid.id) && kidBreaks[kid.id]?.has(w.num));
                // Which selected kids are on break this week
                const kidsOnBreak = kids.filter(kid => selectedKids.has(kid.id) && kidBreaks[kid.id]?.has(w.num));
                return (
                  <div key={w.num} className="week-block">
                    <div className="week-block-header">
                      <div>
                        <div className="week-block-sublabel">Week of</div>
                        <span className="week-block-label">{w.monday}</span>
                      </div>
                      <div style={{ marginLeft: "auto", position: "relative" }}>
                        {isBreakWeek ? (
                          <div className="break-badge" onClick={() => kidsOnBreak.forEach(k => toggleKidWeekBreak(k.id, w.num))} title="Click to remove break">
                            Rest week
                            <button className="break-remove">×</button>
                          </div>
                        ) : (
                          <div style={{ position: "relative" }}>
                            <button className="mark-break-btn" onClick={() => setOpenBreakPicker(openBreakPicker === w.num ? null : w.num)}>
                              Mark as break
                            </button>
                            {openBreakPicker === w.num && (() => {
                              // w.num is now an ISO date string (Monday of the week)
                              const dayNames = ["Mon","Tue","Wed","Thu","Fri"];
                              const days = Array.from({length:5}, (_,i) => {
                                const d = new Date(w.num + "T12:00:00");
                                d.setDate(d.getDate() + i);
                                return { label: dayNames[i], iso: d.toISOString().slice(0,10) };
                              });
                              return (
                                <div className="break-picker">
                                  <div className="break-picker-title">Mark as break</div>
                                  <button className="break-option" onClick={() => { toggleWeekBreak(w.num); setOpenBreakPicker(null); }}>
                                    Whole week off
                                  </button>
                                  <div className="break-picker-divider">or pick specific days</div>
                                  {days.map(day => (
                                    <button key={day.iso} className={`break-option${breaks.has(day.iso) ? " break-option-on" : ""}`}
                                      onClick={() => toggleDayBreak(day.iso)}>
                                      {day.label} {day.iso.slice(5).replace("-","/")}
                                      {breaks.has(day.iso) && <span className="break-check">✓</span>}
                                    </button>
                                  ))}
                                  <button className="break-picker-done" onClick={() => setOpenBreakPicker(null)}>Done</button>
                                </div>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    </div>
                    {allCamps.length === 0 ? (
                      <div className="week-block-inner">
                        <div className="empty-state" style={{ padding: "18px 24px", fontSize: 13 }}>
                          Nothing this week
                        </div>
                      </div>
                    ) : (
                      <div className="week-block-inner">
                      <div className="camp-cards">
                        {/* Break cards for kids on break this week */}
                        {kidsOnBreak.map(kid => (
                          <div key={`break-${kid.id}`} style={{
                            background: "#f6faf2", border: "1px solid #c2d9b0",
                            borderLeft: "4px solid #5a8f35", borderRadius: "var(--radius-lg)",
                            padding: "10px 14px", display: "flex", alignItems: "center",
                            justifyContent: "space-between", gap: 10,
                          }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{
                                width: 26, height: 26, borderRadius: "50%",
                                background: "#5a8f35", color: "white",
                                display: "flex", alignItems: "center", justifyContent: "center",
                                fontSize: 9, fontWeight: 700, flexShrink: 0,
                              }}>{kid.initials}</span>
                              <div>
                                <div style={{ fontWeight: 700, fontSize: 13, color: "#3D6B1F" }}>Taking a break 🌿</div>
                                <div style={{ fontSize: 11, color: "#6B7280", marginTop: 1 }}>{kid.name} is off this week</div>
                              </div>
                            </div>
                            <button onClick={() => toggleKidWeekBreak(kid.id, w.num)} style={{
                              background: "none", border: "1px solid #c2d9b0", borderRadius: 6,
                              padding: "4px 10px", fontFamily: "Inter, sans-serif",
                              fontSize: 11, fontWeight: 500, color: "#5a8f35", cursor: "pointer",
                            }}>Remove</button>
                          </div>
                        ))}
                        {visibleCamps.map((camp) => {
                          const myKidsAtCamp = myKidsCampsThisWeek.filter(mc => mc.id === camp.id);
                          const friendsAtCamp = friendCampsThisWeek[camp.id]?.friends || [];
                          const isMyKidsCamp = myKidsAtCamp.length > 0;
                          const unaddedKids = kids.filter(kid =>
                            selectedKids.has(kid.id) && !getKidStatus(camp.id, kid.id)
                          );

                          // Determine card style by best kid status: enrolled > thinking > waitlist
                          const statuses = myKidsAtCamp.map(kc => kc.status || "enrolled");
                          const cardStatus = statuses.includes("enrolled") ? "enrolled"
                            : statuses.includes("thinking") ? "thinking"
                            : statuses.length > 0 ? "waitlist" : null;
                          const cardStyle = cardStatus === "enrolled"
                            ? { background: "#eef5e8", borderColor: "#c2d9b0", borderLeft: "4px solid #5a8f35" }
                            : cardStatus === "thinking"
                            ? { background: "#fff", borderColor: "#e5e7eb", borderLeft: "4px solid #D97706" }
                            : cardStatus === "waitlist"
                            ? { background: "#fff", borderColor: "#e5e7eb", borderLeft: "4px solid #9CA3AF" }
                            : { background: "#fff", borderColor: "#e5e7eb" };

                          return (
                            <div key={camp.id} className={`camp-card${cardStatus === "enrolled" ? " my-kids" : ""}`} style={cardStyle}>
                              <div className="camp-card-layout">
                                <div className="camp-info">
                                <div className="camp-card-top">
                                  <div>
                                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                                      <a className="camp-name camp-link" href={camp.url} target="_blank" rel="noreferrer">{camp.name}</a>
                                      {camp.campType && (
                                        <span style={{
                                          fontSize: 10.5, fontWeight: 600, color: "#6B7280",
                                          background: "#F3F4F6", border: "1px solid #E5E7EB",
                                          borderRadius: 5, padding: "1px 6px", whiteSpace: "nowrap",
                                        }}>
                                          {(() => { const EMOJIS = { sports:"⚽", art:"🎨", drama:"🎭", outdoors:"🌲", language:"🌍", classic:"🏕️", stem:"🔬", music:"🎵" }; const types = Array.isArray(camp.campType) ? camp.campType : (camp.campType ? [camp.campType] : []); return types.filter(Boolean).map(t => (EMOJIS[t] || "") + " " + t.charAt(0).toUpperCase() + t.slice(1)).join(", "); })()}
                                        </span>
                                      )}
                                    </div>
                                    {camp.userId && (() => {
                                      // Find adder's name from circle members or own account
                                      if (camp.userId === userId) return <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 1 }}>Added by you</div>;
                                      const allMembers = liveCircles.flatMap(c => c.members);
                                      const adder = allMembers.find(m => m.userId === camp.userId);
                                      if (!adder) return null;
                                      return <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 1 }}>Added by {adder.name || adder.child}</div>;
                                    })()}
                                    <div className="camp-meta">
                                      <a className="camp-location-link" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(camp.address)}`} target="_blank" rel="noreferrer" title={camp.address}>{camp.location}<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{display:"inline",verticalAlign:"middle",marginLeft:3,marginBottom:1}}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg></a>
                                      {"  ·  "}{camp.dates}
                                      {"  ·  "}
                                      <span className="camp-hours">
                                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{display:"inline",verticalAlign:"middle",marginRight:3,marginBottom:1}}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                                        {camp.hours}
                                      </span>
                                      {(camp.ageMin || camp.ageMax || camp.gradeMin || camp.gradeMax) && (
                                        <>
                                          {"  ·  "}
                                          <span style={{ whiteSpace: "nowrap" }}>
                                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{display:"inline",verticalAlign:"middle",marginRight:3,marginBottom:1}}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                                            {camp.gradeMin || camp.gradeMax ? (camp.gradeMin && camp.gradeMax ? `Grades ${camp.gradeMin}–${camp.gradeMax}` : camp.gradeMin ? `Grade ${camp.gradeMin}+` : `Up to ${camp.gradeMax}`) : camp.ageMin && camp.ageMax ? `Ages ${camp.ageMin}–${camp.ageMax}` : camp.ageMin ? `Ages ${camp.ageMin}+` : `Up to age ${camp.ageMax}`}
                                          </span>
                                        </>
                                      )}
                                      {camp.cost && (
                                        <>
                                          {"  ·  "}
                                          <span style={{ whiteSpace: "nowrap", fontWeight: 600, color: "#3D6B1F" }}>
                                            ${Number(camp.cost).toLocaleString()}
                                          </span>
                                        </>
                                      )}
                                    </div>
                                    {myKidsAtCamp.length > 0 ? (
                                      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
                                        {myKidsAtCamp.map((kc) => {
                                          const activeDays = kc.enrollment?.days || camp.days || ["M","T","W","Th","F"];
                                          return (
                                            <div key={kc.kidId} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                              {myKidsAtCamp.length > 1 && (
                                                <span style={{ fontSize: 10, fontWeight: 800, color: "#999", width: 18, flexShrink: 0 }}>{kc.kidInitials}</span>
                                              )}
                                              <div className="camp-days-row" style={{ marginTop: 0 }}>
                                                {["M","T","W","Th","F"].map(d => (
                                                  <span key={d} className={`camp-day${activeDays.includes(d) ? " camp-day-on" : ""}`}
                                                    style={activeDays.includes(d) ? { background: "#3D6B1F", borderColor: "#3D6B1F" } : {}}>
                                                    {d}
                                                  </span>
                                                ))}
                                              </div>
                                              {(kc.enrollment?.beforeCare || kc.enrollment?.afterCare) && (
                                                <div style={{ display: "flex", gap: 3 }}>
                                                  {kc.enrollment?.beforeCare && <span className="care-tag">BC</span>}
                                                  {kc.enrollment?.afterCare && <span className="care-tag">AC</span>}
                                                </div>
                                              )}
                                            </div>
                                          );
                                        })}
                                      </div>
                                    ) : null}
                                  </div>
                                  <div style={{ position: "relative", flexShrink: 0 }}>
                                    <button
                                      className="share-btn"
                                      onClick={() => setShareCamp(sharecamp === camp.id ? null : camp.id)}
                                      title="Share this camp"
                                    >
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                        <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
                                        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
                                      </svg>
                                      Share
                                    </button>
                                    {sharecamp === camp.id && (() => {
                                      const links = getShareLinks(camp);
                                      return (
                                        <div className="share-picker">
                                          <a className="share-option" href={links.sms}>
                                            <span className="share-icon">💬</span> Text Message
                                          </a>
                                          <a className="share-option" href={links.whatsapp} target="_blank" rel="noreferrer">
                                            <span className="share-icon">📱</span> WhatsApp
                                          </a>
                                          <a className="share-option" href={links.email}>
                                            <span className="share-icon">✉️</span> Email
                                          </a>
                                          <button className="share-option" onClick={() => { handleNativeShare(camp); setShareCamp(null); }}>
                                            <span className="share-icon">📋</span> {shareCopied ? "Copied!" : "Copy Link"}
                                          </button>
                                        </div>
                                      );
                                    })()}
                                  </div>
                                </div>
                                  </div>
                                  <div className="camp-people-col">
                                  <div className="friend-avatars-row">
                                    {myKidsAtCamp.map((kc, i) => {
                                      const st = STATUS_CONFIG[kc.status] || STATUS_CONFIG.enrolled;
                                      return (
                                        <div key={"kid-" + i}>
                                          <button
                                            className="kid-status-btn"
                                            style={{ background: st.bg }}
                                            onClick={() => openStatusPicker(camp.id, kc.kidId, camp.name, kc.kidName, kc.status)}
                                          >
                                            <span className="kid-status-initials">{kc.kidInitials}</span>
                                            <span className="status-icon-wrap"><StatusIcon s={kc.status || "enrolled"} size={13} color="rgba(255,255,255,0.95)" /></span>
                                            <span className="kid-status-label">{st.label}</span>
                                          </button>
                                        </div>
                                      );
                                    })}
                                    {myKidsAtCamp.length === 0 && unaddedKids.length > 0 && (
                                      <div style={{ display: "flex", gap: 5 }}>
                                        {unaddedKids.map(kid => (
                                          <button key={kid.id} className="add-camp-btn"
                                            onClick={() => openEnrollModal(camp.id, kid.id, "enrolled", camp.days)}>
                                            + Add {kid.name}
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                              {/* ── FRIENDS BOTTOM STRIP ── */}
                              {(() => {
                                const allPeople = [...friendsAtCamp];
                                const hasUnadded = myKidsAtCamp.length > 0 && unaddedKids.length > 0;
                                if (allPeople.length === 0 && !hasUnadded) return null;
                                const groups = [
                                  { key: "enrolled",  label: "Going",      color: "#5a8f35" },
                                  { key: "thinking",  label: "Interested", color: "#D97706" },
                                  { key: "waitlist",  label: "Waitlisted", color: "#9CA3AF" },
                                ].map(g => ({ ...g, people: allPeople.filter(f => (f.status || "enrolled") === g.key) }))
                                 .filter(g => g.people.length > 0);
                                return (
                                  <div style={{
                                    marginTop: 10, paddingTop: 8,
                                    borderTop: "1px solid #e0e8d8",
                                    display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap"
                                  }}>
                                    {groups.map(({ key, label, color, people }, gi) => {
                                      const shown = people.slice(0, 5);
                                      const extra = people.length - shown.length;
                                      return (
                                        <div key={key} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                                          {gi > 0 && <div style={{ width: 1, height: 18, background: "#ddd", marginRight: 6 }} />}
                                          <div style={{ display: "flex" }}>
                                            {shown.map((f, fi) => (
                                              <div key={fi} className="friend-avatar" style={{ zIndex: shown.length - fi, marginLeft: fi === 0 ? 0 : -7 }}>
                                                <div className="initials-circle" style={{ background: color, width: 24, height: 24, fontSize: 8 }}>
                                                  {f.initials}
                                                </div>
                                                <div className="tooltip">{f.name}</div>
                                              </div>
                                            ))}
                                            {extra > 0 && (
                                              <div className="friend-overflow" style={{ width: 24, height: 24, fontSize: 8, marginLeft: -7 }}>+{extra}</div>
                                            )}
                                          </div>
                                          <span style={{ fontSize: 10, fontWeight: 700, color }}>{label}</span>
                                        </div>
                                      );
                                    })}
                                    {hasUnadded && (
                                      <div style={{ marginLeft: "auto", display: "flex", gap: 5 }}>
                                        {unaddedKids.map(kid => (
                                          <button key={kid.id} className="add-camp-btn"
                                            onClick={() => openEnrollModal(camp.id, kid.id, "enrolled", camp.days)}>
                                            + Add {kid.name}
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}
                            </div>
                          );
                        })}
                        {hiddenCount > 0 && !isExpanded && (
                          <button className="show-more-btn" onClick={() => toggleWeekExpanded(w.num)}>
                            Show {hiddenCount} more camp{hiddenCount > 1 ? "s" : ""}
                          </button>
                        )}
                        {isExpanded && allCamps.length > LIMIT && (
                          <button className="show-more-btn show-less" onClick={() => toggleWeekExpanded(w.num)}>
                            Show less
                          </button>
                        )}
                        {/* ── ADD CAMP FOR THIS WEEK ── */}
                        {weekAddCamp === w.num ? (
                          <div style={{
                            marginTop: 6, padding: "10px 12px",
                            background: "#f6faf2", border: "1px solid #c2d9b0",
                            borderRadius: 8, display: "flex", flexDirection: "column", gap: 8
                          }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: "#3D6B1F", textTransform: "uppercase", letterSpacing: "0.6px" }}>
                              Add a camp - {w.label}
                            </div>
                            <div style={{ display: "flex", gap: 6 }}>
                              <input
                                autoFocus
                                value={weekAddName}
                                onChange={e => setWeekAddName(e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === "Enter" && weekAddName.trim()) {
                                    const CAMP_COLORS_LIST = ["#3D6B1F","#4a7c28","#D97706","#0284C7","#7C3AED","#DC2626","#0369A1","#b45309"];
                                    const newCamp = {
                                      id: Date.now(), name: weekAddName.trim(), url: "#",
                                      color: CAMP_COLORS_LIST[dynamicCamps.length % CAMP_COLORS_LIST.length],
                                      dates: w.dates, location: "", address: "", week: w.num,
                                      hours: "", days: ["M","T","W","Th","F"],
                                    };
                                    setDynamicCamps(prev => [...prev, newCamp]);
                                    setWeekAddName(""); setWeekAddCamp(null);
                                  }
                                  if (e.key === "Escape") { setWeekAddName(""); setWeekAddCamp(null); }
                                }}
                                placeholder="Camp name…"
                                style={{
                                  flex: 1, padding: "7px 10px", border: "1px solid #c2d9b0",
                                  borderRadius: 6, fontFamily: "Inter, sans-serif", fontSize: 13,
                                  color: "#111827", outline: "none", background: "white"
                                }}
                              />
                              <button
                                onClick={() => {
                                  if (!weekAddName.trim()) return;
                                  const CAMP_COLORS_LIST = ["#3D6B1F","#4a7c28","#D97706","#0284C7","#7C3AED","#DC2626","#0369A1","#b45309"];
                                  const newCamp = {
                                    id: Date.now(), name: weekAddName.trim(), url: "#",
                                    color: CAMP_COLORS_LIST[dynamicCamps.length % CAMP_COLORS_LIST.length],
                                    dates: w.dates, location: "", address: "", week: w.num,
                                    hours: "", days: ["M","T","W","Th","F"],
                                  };
                                  setDynamicCamps(prev => [...prev, newCamp]);
                                  setWeekAddName(""); setWeekAddCamp(null);
                                }}
                                disabled={!weekAddName.trim()}
                                style={{
                                  background: "#3D6B1F", color: "white", border: "none",
                                  borderRadius: 6, padding: "7px 14px", fontFamily: "Inter, sans-serif",
                                  fontWeight: 600, fontSize: 13, cursor: weekAddName.trim() ? "pointer" : "default",
                                  opacity: weekAddName.trim() ? 1 : 0.4,
                                }}
                              >Add</button>
                              <button
                                onClick={() => { setWeekAddName(""); setWeekAddCamp(null); }}
                                style={{
                                  background: "none", border: "1px solid #c2d9b0", borderRadius: 6,
                                  padding: "7px 10px", fontFamily: "Inter, sans-serif", fontWeight: 500,
                                  fontSize: 13, color: "#6B7280", cursor: "pointer"
                                }}
                              >Cancel</button>
                            </div>
                            <div style={{ fontSize: 11, color: "#9CA3AF" }}>Press Enter or click Add - you can fill in details on the Add Camp tab</div>
                          </div>
                        ) : (
                          <button
                            className="show-more-btn"
                            style={{ color: "#3D6B1F", borderColor: "#c2d9b0", marginTop: 4 }}
                            onClick={() => { setWeekAddCamp(w.num); setWeekAddName(""); }}
                          >
                            + Add a camp this week
                          </button>
                        )}
                      </div>
                      </div>
                    )}
                  </div>
                );
              })(); })}
            </>
          )}

          {/* ── KIDS TAB ── */}
          {activeTab === "kids" && (() => {
            const TYPES = [
              { value: "sports",   label: "Sports",   emoji: "⚽" },
              { value: "art",      label: "Art",       emoji: "🎨" },
              { value: "drama",    label: "Drama",     emoji: "🎭" },
              { value: "outdoors", label: "Outdoors",  emoji: "🌲" },
              { value: "language", label: "Language",  emoji: "🌍" },
              { value: "classic",  label: "Classic",   emoji: "🏕️" },
              { value: "stem",     label: "STEM",      emoji: "🔬" },
              { value: "music",    label: "Music",     emoji: "🎵" },
              { value: "academics", label: "Academics", emoji: "📚" },
              { value: "gaming",    label: "Gaming",    emoji: "🎮" },
            ];
            const AGES = ["4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15"];
            const kid = kids.find(k => k.id === profileKidId);
            const profile = kidProfiles[profileKidId] || { interests: new Set(), zipcode: "", visible: true, age: "", bio: "" };
            const interests = profile.interests instanceof Set ? profile.interests : new Set(profile.interests || []);
            const kidName = kids.find(k => k.id === profileKidId)?.name || "";
            const kidFirstName = kidName.split(" ")[0];
            const kidCircles = liveCircles.filter(c => c.members.some(m => {
              if (m.userId !== userId) return false;
              if (!m.child) return true; // no child name = match all
              return m.child === kidName || m.child === kidFirstName || kidName.startsWith(m.child);
            }));
            const allCampPool = [...camps, ...airtableCamps, ...dynamicCamps];
            const kidEnrolledCamps = allCampPool.filter(c => campStatus[c.id]?.[profileKidId]);

            if (loading) return (
              <div style={{ textAlign: "center", padding: "60px 0", color: "#9CA3AF", fontSize: 14 }}>Loading...</div>
            );

            if (kids.length === 0 && !addingKid) return (
              <div style={{ textAlign: "center", padding: "60px 20px" }}>
                <div style={{ fontSize: 40, marginBottom: 16 }}>👧🏽</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#1F2937", marginBottom: 8 }}>Add your first child</div>
                <div style={{ fontSize: 14, color: "#6B7280", marginBottom: 24 }}>Add your child's name to get started tracking camps.</div>
                <button
                  onClick={() => setAddingKid(true)}
                  style={{ background: "#3D6B1F", border: "none", borderRadius: 10, padding: "10px 24px", fontFamily: "Inter, sans-serif", fontSize: 14, fontWeight: 700, color: "white", cursor: "pointer" }}
                >+ Add a Child</button>
              </div>
            );

            if (kids.length === 0 && addingKid) {
              const doSave = async () => {
                if (!newKidName.trim() || savingKid) return;
                setSavingKid(true);
                const firstName = newKidName.trim();
                const lastI = newKidLastInitial.trim().toUpperCase().slice(0, 1);
                const displayName = lastI ? `${firstName} ${lastI}.` : firstName;
                const initials = (firstName[0] + (lastI || firstName[1] || "")).toUpperCase();
                const newKid = await saveKid(userId, displayName, initials);
                await updateCircleMemberKid(userId, displayName).catch(console.error);
                setAirtableKids(prev => [...prev, newKid]);
                setProfileKidId(newKid.id);
                setSelectedKids(new Set([newKid.id]));
                // Reload circles to pick up updated member name
                getCircles(userId).then(setAirtableCircles).catch(console.error);
                setNewKidName(""); setNewKidLastInitial(""); setAddingKid(false); setSavingKid(false);
              };
              return (
                <div style={{ maxWidth: 400, margin: "60px auto", textAlign: "center" }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "#1F2937", marginBottom: 24 }}>What's your child's name?</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <input autoFocus placeholder="First name" value={newKidName} onChange={e => setNewKidName(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") doSave(); }}
                      style={{ width: "100%", padding: "12px 16px", border: "2px solid #3D6B1F", borderRadius: 10, fontFamily: "Inter, sans-serif", fontSize: 15, fontWeight: 600, color: "#1F2937", outline: "none" }} />
                    <input placeholder="Last initial (optional)" value={newKidLastInitial} maxLength={1} onChange={e => setNewKidLastInitial(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") doSave(); }}
                      style={{ width: "100%", padding: "12px 16px", border: "2px solid #E5E7EB", borderRadius: 10, fontFamily: "Inter, sans-serif", fontSize: 15, fontWeight: 600, color: "#1F2937", outline: "none" }} />
                    <button disabled={!newKidName.trim() || savingKid} onClick={doSave}
                      style={{ background: "#3D6B1F", border: "none", borderRadius: 10, padding: "12px", fontFamily: "Inter, sans-serif", fontSize: 15, fontWeight: 700, color: "white", cursor: "pointer", opacity: newKidName.trim() ? 1 : 0.4 }}>
                      {savingKid ? "Saving..." : "Add Child"}
                    </button>
                    <button onClick={() => setAddingKid(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "#9CA3AF", fontSize: 14 }}>Cancel</button>
                  </div>
                </div>
              );
            }

            return (
              <div>
                {/* Kid switcher + add kid */}
                <div style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap", alignItems: "center" }}>
                  {kids.map(k => (
                    <button key={k.id}
                      onClick={() => setProfileKidId(k.id)}
                      style={{
                        display: "flex", alignItems: "center", gap: 8,
                        padding: "8px 16px", borderRadius: 10, cursor: "pointer",
                        fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 14,
                        border: `2px solid ${profileKidId === k.id ? "#3D6B1F" : "#E5E7EB"}`,
                        background: profileKidId === k.id ? "#3D6B1F" : "white",
                        color: profileKidId === k.id ? "white" : "#374151",
                        transition: "all 0.12s",
                      }}
                    >
                      <div style={{
                        width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
                        background: profileKidId === k.id ? "rgba(255,255,255,0.25)" : "#eef5e8",
                        color: profileKidId === k.id ? "white" : "#3D6B1F",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 9, fontWeight: 800,
                      }}>{k.initials}</div>
                      {k.name}
                    </button>
                  ))}
                  {/* Add a kid button */}
                  {(() => {
                    const doSave = async () => {
                      if (!newKidName.trim() || savingKid) return;
                      setSavingKid(true);
                      const firstName = newKidName.trim();
                      const lastI = newKidLastInitial.trim().toUpperCase().slice(0, 1);
                      const displayName = lastI ? `${firstName} ${lastI}.` : firstName;
                      const initials = (firstName[0] + (lastI || firstName[1] || "")).toUpperCase();
                      const newKid = await saveKid(userId, displayName, initials);
                      await updateCircleMemberKid(userId, displayName).catch(console.error);
                      setAirtableKids(prev => [...prev, newKid]);
                      setProfileKidId(newKid.id);
                      getCircles(userId).then(setAirtableCircles).catch(console.error);
                      setNewKidName(""); setNewKidLastInitial(""); setAddingKid(false); setSavingKid(false);
                    };
                    return addingKid ? (
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <input
                          autoFocus
                          placeholder="First name"
                          value={newKidName}
                          onChange={e => setNewKidName(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter") doSave(); if (e.key === "Escape") { setNewKidName(""); setNewKidLastInitial(""); setAddingKid(false); } }}
                          style={{ padding: "8px 14px", border: "2px solid #3D6B1F", borderRadius: 10, fontFamily: "Inter, sans-serif", fontSize: 14, fontWeight: 600, color: "#1F2937", outline: "none", width: 130 }}
                        />
                        <input
                          placeholder="Last initial"
                          value={newKidLastInitial}
                          maxLength={1}
                          onChange={e => setNewKidLastInitial(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter") doSave(); if (e.key === "Escape") { setNewKidName(""); setNewKidLastInitial(""); setAddingKid(false); } }}
                          style={{ padding: "8px 14px", border: "2px solid #3D6B1F", borderRadius: 10, fontFamily: "Inter, sans-serif", fontSize: 14, fontWeight: 600, color: "#1F2937", outline: "none", width: 100 }}
                        />
                        <button
                          disabled={!newKidName.trim() || savingKid}
                          onClick={doSave}
                          style={{ background: "#3D6B1F", border: "none", borderRadius: 10, padding: "8px 16px", fontFamily: "Inter, sans-serif", fontSize: 14, fontWeight: 700, color: "white", cursor: "pointer", opacity: newKidName.trim() && !savingKid ? 1 : 0.4 }}
                        >{savingKid ? "Saving..." : "Add"}</button>
                        <button onClick={() => { setNewKidName(""); setNewKidLastInitial(""); setAddingKid(false); }}
                          style={{ background: "none", border: "none", cursor: "pointer", color: "#9CA3AF", fontSize: 14 }}>Cancel</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setAddingKid(true)}
                        style={{
                          display: "flex", alignItems: "center", gap: 6,
                          padding: "8px 16px", borderRadius: 10, cursor: "pointer",
                          fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 14,
                          border: "2px dashed #D1D5DB", background: "white", color: "#9CA3AF",
                          transition: "all 0.12s",
                        }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = "#3D6B1F"; e.currentTarget.style.color = "#3D6B1F"; }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = "#D1D5DB"; e.currentTarget.style.color = "#9CA3AF"; }}
                      >
                        + Add a kid
                      </button>
                    );
                  })()}
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

                  {/* Parent name card */}
                  <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: "var(--radius-xl)", padding: "16px 20px", boxShadow: "var(--shadow-sm)", marginBottom: 14 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>Your Name</div>
                    <input
                      placeholder="Your name (shown to other parents)"
                      value={parentName}
                      onChange={e => setParentName(e.target.value)}
                      onBlur={async () => {
                        if (parentName.trim()) {
                          await updateParentName(userId, parentName.trim()).catch(console.error);
                          getCircles(userId).then(setAirtableCircles).catch(console.error);
                        }
                      }}
                      style={{ width: "100%", fontWeight: 600, fontSize: 15, color: "#1F2937", border: "none", outline: "none", background: "transparent", fontFamily: "Inter, sans-serif", padding: 0 }}
                      onFocus={e => e.target.style.borderBottom = "2px solid #3D6B1F"}
                    />
                  </div>

                  {/* Profile card */}
                  <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: "var(--radius-xl)", padding: "20px", boxShadow: "var(--shadow-sm)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
                      <div style={{
                        width: 56, height: 56, borderRadius: "50%",
                        background: "#3D6B1F", color: "white",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 16, fontWeight: 800, flexShrink: 0,
                      }}>{kid?.initials}</div>
                      <div style={{ flex: 1 }}>
                        <input
                          value={kid?.name || ""}
                          onChange={e => {
                            const name = e.target.value;
                            const initials = name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
                            updateKidName(profileKidId, name, initials);
                          }}
                          style={{ fontWeight: 800, fontSize: 20, color: "#1F2937", border: "none", outline: "none", background: "transparent", width: "100%", fontFamily: "Inter, sans-serif", padding: 0 }}
                          onFocus={e => e.target.style.borderBottom = "2px solid #3D6B1F"}
                          onBlur={e => e.target.style.borderBottom = "none"}
                        />
                        {profile.age && <div style={{ fontSize: 13, color: "#6B7280", marginTop: 2 }}>Age {profile.age}</div>}
                      </div>
                      {/* Visibility toggle */}
                      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 12, color: "#6B7280", fontWeight: 500 }}>
                          Visible to other parents in your circle(s)
                        </span>
                        <button
                          onClick={() => updateKidProfile(profileKidId, "visible", !profile.visible)}
                          style={{
                            width: 44, height: 24, borderRadius: 12, border: "none",
                            background: (profile.visible !== false) ? "#3D6B1F" : "#D1D5DB",
                            cursor: "pointer", position: "relative", transition: "background 0.2s", flexShrink: 0,
                          }}
                        >
                          <div style={{
                            width: 18, height: 18, borderRadius: "50%", background: "white",
                            position: "absolute", top: 3,
                            left: (profile.visible !== false) ? 23 : 3,
                            transition: "left 0.2s",
                            boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                          }} />
                        </button>
                      </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                      <div>
                        <label style={{ fontSize: 11.5, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: 6 }}>Age</label>
                        <select
                          value={profile.age}
                          onChange={e => updateKidProfile(profileKidId, "age", e.target.value)}
                          style={{
                            width: "100%", padding: "8px 12px", border: "1.5px solid #E5E7EB",
                            borderRadius: 8, fontFamily: "Inter, sans-serif", fontSize: 13,
                            color: profile.age ? "#1F2937" : "#9CA3AF",
                            background: "white", outline: "none", cursor: "pointer",
                            appearance: "none", backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239CA3AF' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
                            backgroundRepeat: "no-repeat", backgroundPosition: "right 10px center",
                            paddingRight: 32,
                          }}
                          onFocus={e => e.target.style.borderColor = "#3D6B1F"}
                          onBlur={e => e.target.style.borderColor = "#E5E7EB"}
                        >
                          <option value="">Select age</option>
                          {Array.from({ length: 17 }, (_, i) => i + 2).map(a => (
                            <option key={a} value={String(a)}>{a} years old</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label style={{ fontSize: 11.5, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: 6 }}>Zip Code</label>
                        <input
                          type="text" maxLength={5}
                          placeholder="e.g. 90210"
                          value={profile.zipcode}
                          onChange={e => updateKidProfile(profileKidId, "zipcode", e.target.value.replace(/\D/g, ""))}
                          style={{
                            width: "100%", padding: "8px 12px", border: "1.5px solid #E5E7EB",
                            borderRadius: 8, fontFamily: "Inter, sans-serif", fontSize: 13,
                            color: "#1F2937", outline: "none",
                          }}
                          onFocus={e => e.target.style.borderColor = "#3D6B1F"}
                          onBlur={e => e.target.style.borderColor = "#E5E7EB"}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Interests */}
                  <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: "var(--radius-xl)", padding: "20px", boxShadow: "var(--shadow-sm)" }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: "#1F2937", marginBottom: 4 }}>Interests</div>
                    <div style={{ fontSize: 12.5, color: "#9CA3AF", marginBottom: 14 }}>Select what {kid?.name} enjoys - this helps match with camps and friends</div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {TYPES.map(t => {
                        const active = interests.has(t.value);
                        return (
                          <button key={t.value}
                            onClick={() => {
                              const next = new Set(interests);
                              active ? next.delete(t.value) : next.add(t.value);
                              updateKidProfile(profileKidId, "interests", next);
                            }}
                            style={{
                              display: "flex", alignItems: "center", gap: 6,
                              padding: "8px 14px", borderRadius: 10, cursor: "pointer",
                              fontFamily: "Inter, sans-serif", fontSize: 13, fontWeight: 600,
                              background: active ? "#3D6B1F" : "white",
                              color: active ? "white" : "#374151",
                              border: `2px solid ${active ? "#3D6B1F" : "#E5E7EB"}`,
                              transition: "all 0.12s",
                            }}
                          >
                            <span style={{ fontSize: 16 }}>{t.emoji}</span> {t.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Circles */}
                  <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: "var(--radius-xl)", padding: "20px", boxShadow: "var(--shadow-sm)" }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: "#1F2937", marginBottom: 14 }}>Circles</div>
                    {kidCircles.length === 0 ? (
                      <div style={{ fontSize: 13, color: "#9CA3AF", marginBottom: 14 }}>Not in any circles yet</div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
                        {kidCircles.map(c => (
                          <div key={c.id} style={{
                            display: "flex", alignItems: "center", gap: 12,
                            padding: "10px 14px", borderRadius: 10,
                            background: "#F9FAFB", border: "1px solid #F3F4F6",
                          }}>
                            <div style={{
                              width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                              background: c.color + "22", color: c.color,
                              display: "flex", alignItems: "center", justifyContent: "center",
                              fontWeight: 800, fontSize: 14,
                            }}>{c.name[0]}</div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 700, fontSize: 13, color: "#1F2937" }}>{c.name}</div>
                              <div style={{ fontSize: 11.5, color: "#9CA3AF", marginTop: 1 }}>{c.members.length} families</div>
                            </div>
                            <div style={{ display: "flex", marginLeft: "auto" }}>
                              {c.members.slice(0, 4).map((m, i) => (
                                <div key={m.id} title={m.child} style={{
                                  width: 24, height: 24, borderRadius: "50%",
                                  background: c.color, color: "white",
                                  border: "2px solid white",
                                  display: "flex", alignItems: "center", justifyContent: "center",
                                  fontSize: 8, fontWeight: 800, marginLeft: i > 0 ? -6 : 0,
                                  position: "relative", zIndex: 4 - i,
                                }}>
                                  {getMemberInitials(m.child, m.name)}
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Join a circle by invite code */}
                    <div style={{ borderTop: "1px solid #F3F4F6", paddingTop: 14, marginTop: kidCircles.length > 0 ? 0 : 4 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "#6B7280", marginBottom: 8 }}>Have an invite code? Join a circle</div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <input
                          placeholder="Enter invite code"
                          value={joinCode}
                          onChange={e => { setJoinCode(e.target.value.toUpperCase()); setJoinError(""); }}
                          style={{ flex: 1, padding: "8px 12px", border: "1.5px solid #E5E7EB", borderRadius: 8, fontFamily: "Inter, sans-serif", fontSize: 13, color: "#1F2937", outline: "none", letterSpacing: "0.1em" }}
                          onFocus={e => e.target.style.borderColor = "#3D6B1F"}
                          onBlur={e => e.target.style.borderColor = "#E5E7EB"}
                        />
                        <button
                          disabled={!joinCode.trim() || joinLoading}
                          onClick={async () => {
                            setJoinLoading(true); setJoinError("");
                            try {
                              const result = await joinCircleByCode(joinCode.trim(), userId, parentName, kids.find(k => k.id === profileKidId)?.name || "");
                              if (result) {
                                setAirtableCircles(prev => {
                                  const existing = prev.find(c => c.id === result.id);
                                  return existing ? prev.map(c => c.id === result.id ? result : c) : [...prev, result];
                                });
                                setJoinCode("");
                              } else { setJoinError("Invalid code"); }
                            } catch { setJoinError("Invalid code"); }
                            setJoinLoading(false);
                          }}
                          style={{ background: joinCode.trim() ? "#3D6B1F" : "#E5E7EB", border: "none", borderRadius: 8, padding: "8px 16px", fontFamily: "Inter, sans-serif", fontSize: 13, fontWeight: 700, color: joinCode.trim() ? "white" : "#9CA3AF", cursor: joinCode.trim() ? "pointer" : "default" }}
                        >
                          {joinLoading ? "..." : "Join"}
                        </button>
                      </div>
                      {joinError && <div style={{ fontSize: 12, color: "#EF4444", marginTop: 6 }}>{joinError}</div>}
                    </div>
                  </div>

                  {/* Enrolled camps summary */}
                  {kidEnrolledCamps.length > 0 && (
                    <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: "var(--radius-xl)", padding: "20px", boxShadow: "var(--shadow-sm)" }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: "#1F2937", marginBottom: 14 }}>This Summer</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {kidEnrolledCamps.map(c => {
                          const s = campStatus[c.id]?.[profileKidId];
                          const status = typeof s === "string" ? s : s?.status;
                          const statusColor = status === "enrolled" ? "#3D6B1F" : status === "thinking" ? "#D97706" : "#9CA3AF";
                          const statusBg = status === "enrolled" ? "#eef5e8" : status === "thinking" ? "#FEF3C7" : "#F3F4F6";
                          return (
                            <div key={c.id} style={{
                              display: "flex", alignItems: "center", gap: 10,
                              padding: "8px 12px", borderRadius: 8,
                              background: statusBg, border: `1px solid ${statusColor}33`,
                            }}>
                              <div style={{ width: 8, height: 8, borderRadius: "50%", background: c.color, flexShrink: 0 }} />
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontWeight: 600, fontSize: 13, color: "#1F2937" }}>{c.name}</div>
                                <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 1 }}>{c.dates} · {c.location}</div>
                              </div>
                              <span style={{ fontSize: 11, fontWeight: 700, color: statusColor, flexShrink: 0 }}>
                                {status === "enrolled" ? "✓ Enrolled" : status === "thinking" ? "Thinking" : "Waitlisted"}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Important Dates */}
                  {(() => {
                    const kidDates = importantDates.filter(d => d.kidId === profileKidId);
                    const fmt = (iso) => { if (!iso) return ""; const d = new Date(iso + "T12:00:00"); return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }); };
                    return (
                      <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: "var(--radius-xl)", padding: "20px", boxShadow: "var(--shadow-sm)" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                          <div style={{ fontWeight: 700, fontSize: 14, color: "#1F2937" }}>Important Dates</div>
                          <button onClick={() => setAddingDate(true)} style={{ background: "none", border: "1px solid #E5E7EB", borderRadius: 7, padding: "4px 10px", fontFamily: "Inter, sans-serif", fontSize: 12, fontWeight: 600, color: "#374151", cursor: "pointer" }}>+ Add</button>
                        </div>

                        {kidDates.length === 0 && !addingDate && (
                          <div style={{ fontSize: 13, color: "#9CA3AF" }}>No important dates yet - add school holidays, last day of school, etc.</div>
                        )}

                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          {kidDates.map(d => (
                            <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 8, background: "#FFF8E6", border: "1px solid #F5D87A" }}>
                              <span style={{ fontSize: 14, flexShrink: 0 }}>📅</span>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontWeight: 600, fontSize: 13, color: "#1F2937" }}>{d.label}</div>
                                <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 1 }}>
                                  {d.dateEnd && d.dateEnd !== d.dateStart ? `${fmt(d.dateStart)} – ${fmt(d.dateEnd)}` : fmt(d.dateStart)}
                                </div>
                              </div>
                              <button onClick={async () => { await deleteImportantDate(d.id).catch(console.error); setImportantDates(prev => prev.filter(x => x.id !== d.id)); }}
                                style={{ background: "none", border: "none", cursor: "pointer", color: "#D1D5DB", fontSize: 16, padding: "0 4px" }}
                                onMouseEnter={e => e.currentTarget.style.color = "#EF4444"}
                                onMouseLeave={e => e.currentTarget.style.color = "#D1D5DB"}
                              >×</button>
                            </div>
                          ))}

                          {addingDate && (
                            <div style={{ padding: "12px", borderRadius: 8, background: "#F9FAFB", border: "1px solid #E5E7EB", display: "flex", flexDirection: "column", gap: 8 }}>
                              <input autoFocus placeholder="Label (e.g. Last day of school)" value={newDateLabel} onChange={e => setNewDateLabel(e.target.value)}
                                style={{ width: "100%", padding: "7px 10px", border: "1.5px solid #E5E7EB", borderRadius: 7, fontFamily: "Inter, sans-serif", fontSize: 13, color: "#1F2937", outline: "none" }}
                                onFocus={e => e.target.style.borderColor = "#3D6B1F"} onBlur={e => e.target.style.borderColor = "#E5E7EB"} />
                              <div style={{ display: "flex", gap: 8 }}>
                                <div style={{ flex: 1 }}>
                                  <div style={{ fontSize: 11, fontWeight: 600, color: "#6B7280", marginBottom: 4 }}>Date</div>
                                  <input type="date" value={newDateStart} onChange={e => setNewDateStart(e.target.value)}
                                    style={{ width: "100%", padding: "7px 10px", border: "1.5px solid #E5E7EB", borderRadius: 7, fontFamily: "Inter, sans-serif", fontSize: 13, color: "#1F2937", outline: "none" }} />
                                </div>
                                <div style={{ flex: 1 }}>
                                  <div style={{ fontSize: 11, fontWeight: 600, color: "#6B7280", marginBottom: 4 }}>End date (optional)</div>
                                  <input type="date" value={newDateEnd} onChange={e => setNewDateEnd(e.target.value)}
                                    style={{ width: "100%", padding: "7px 10px", border: "1.5px solid #E5E7EB", borderRadius: 7, fontFamily: "Inter, sans-serif", fontSize: 13, color: "#1F2937", outline: "none" }} />
                                </div>
                              </div>
                              <div style={{ display: "flex", gap: 8 }}>
                                <button disabled={!newDateLabel.trim() || !newDateStart || savingDate}
                                  onClick={async () => {
                                    setSavingDate(true);
                                    const newDate = await saveImportantDate(profileKidId, newDateLabel.trim(), newDateStart, newDateEnd || null).catch(console.error);
                                    if (newDate) setImportantDates(prev => [...prev, newDate]);
                                    setNewDateLabel(""); setNewDateStart(""); setNewDateEnd(""); setAddingDate(false); setSavingDate(false);
                                  }}
                                  style={{ background: "#3D6B1F", border: "none", borderRadius: 7, padding: "7px 16px", fontFamily: "Inter, sans-serif", fontSize: 13, fontWeight: 700, color: "white", cursor: "pointer", opacity: newDateLabel.trim() && newDateStart ? 1 : 0.4 }}>
                                  {savingDate ? "Saving..." : "Save"}
                                </button>
                                <button onClick={() => { setNewDateLabel(""); setNewDateStart(""); setNewDateEnd(""); setAddingDate(false); }}
                                  style={{ background: "none", border: "1px solid #E5E7EB", borderRadius: 7, padding: "7px 14px", fontFamily: "Inter, sans-serif", fontSize: 13, fontWeight: 500, color: "#6B7280", cursor: "pointer" }}>Cancel</button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                </div>
              </div>
            );
          })()}

          {/* ── CIRCLES TAB ── */}
          {activeTab === "circles" && (
            <>
              <h1 className="section-title">My Circles</h1>
              <p className="section-sub">1st grade friends and other parent groups with whom you share camp plans.</p>

              <div className="liveCircles-grid">
                {liveCircles.map((circle) => {
                  const isOpen = expandedMember?.circleId === circle.id || false;
                  return (
                    <div key={circle.id} className="circle-card">
                      <div
                        className="circle-header"
                        onClick={() =>
                          setExpandedMember(
                            expandedMember?.circleId === circle.id ? null : { circleId: circle.id, memberId: null }
                          )
                        }
                      >
                        <div className="circle-header-left">
                          <div
                            className="circle-icon"
                            style={{ background: circle.color + "22", color: circle.color }}
                          ></div>
                          <div>
                            {editingCircleId === circle.id ? (
                              <input
                                autoFocus
                                value={editingCircleName}
                                onChange={e => setEditingCircleName(e.target.value)}
                                onBlur={async () => {
                                  const name = editingCircleName.trim();
                                  if (name && name !== circle.name) {
                                    await updateCircle(circle.id, name).catch(console.error);
                                    setAirtableCircles(prev => prev.map(c => c.id === circle.id ? { ...c, name } : c));
                                  }
                                  setEditingCircleId(null);
                                }}
                                onKeyDown={e => {
                                  if (e.key === "Enter") e.target.blur();
                                  if (e.key === "Escape") { setEditingCircleId(null); }
                                }}
                                onClick={e => e.stopPropagation()}
                                style={{ fontSize: 15, fontWeight: 700, color: "var(--gray-900)", border: "none", borderBottom: "2px solid #3D6B1F", outline: "none", background: "transparent", fontFamily: "Inter, sans-serif", padding: "0 2px", width: "100%" }}
                              />
                            ) : (
                              <div className="circle-name" style={{ cursor: "text" }}
                                onClick={e => { e.stopPropagation(); setEditingCircleId(circle.id); setEditingCircleName(circle.name); }}
                                title="Click to rename"
                              >{circle.name} <span style={{ fontSize: 11, color: "#D1D5DB", marginLeft: 4 }}>✎</span></div>
                            )}
                            <div className="circle-count">{circle.members.length} families</div>
                          </div>
                        </div>
                        <span className={`circle-chevron ${expandedMember?.circleId === circle.id ? "open" : ""}`}>▾</span>
                      </div>

                      {expandedMember?.circleId === circle.id && (
                        <div className="circle-members">
                          {circle.members.map((m) => {
                            const allCampPool = [...camps, ...airtableCamps, ...dynamicCamps];
                            const memberCamps = m.camps.map(cid => allCampPool.find(c => c.id === cid)).filter(Boolean);
                            const isMemberOpen = expandedMember?.memberId === m.id;
                            const displayName = m.name || "Parent";
                            const childDisplay = m.child || "";
                            return (
                              <div key={m.id}>
                                <div
                                  className="member-row"
                                  onClick={() => setExpandedMember({ circleId: circle.id, memberId: isMemberOpen ? null : m.id })}
                                >
                                  <div className="member-left">
                                    <div className="member-avatar-wrap" style={{ fontSize: "11px", fontWeight: 800, color: "#666" }}>{getMemberInitials(childDisplay, displayName)}</div>
                                    <div>
                                      <div className="member-name">{displayName}</div>
                                      <div className="member-child">{childDisplay ? `Parent of ${childDisplay}` : "No child added yet"}</div>
                                    </div>
                                  </div>
                                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    {/* BFF star — per kid */}
                                    {kids.map(k => {
                                      const isBff = m.userId ? getBffs(k.id).has(m.userId) : false;
                                      return (
                                        <button key={k.id}
                                          title={`${isBff ? "Remove" : "Mark"} as BFF for ${k.name}`}
                                          onClick={e => { e.stopPropagation(); toggleBff(k.id, m.userId); }}
                                          style={{ background: "none", border: "none", cursor: "pointer", padding: "2px 4px", fontSize: 16, lineHeight: 1, opacity: isBff ? 1 : 0.25, transition: "opacity 0.15s, transform 0.15s", transform: isBff ? "scale(1.1)" : "scale(1)" }}
                                        >⭐</button>
                                      );
                                    })}
                                    <span className="member-camp-count">{memberCamps.length} camps</span>
                                  </div>
                                </div>
                                {isMemberOpen && memberCamps.length > 0 && (
                                  <div className="member-camps-detail">
                                    {memberCamps.map((c) => (
                                      <div key={c.id} className="member-camp-pill">
                                        <span>{c.emoji}</span>
                                        <span style={{ color: c.color, flex: 1 }}>{c.name}</span>
                                        <span style={{ color: "#aaa", fontSize: 11 }}>{c.dates}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                          {/* Invite row */}
                          {inviteCircleId === circle.id ? (
                            <div className="invite-form">
                              <div className="invite-form-title">Invite to {circle.name}</div>
                              {circle.inviteCode && (
                                <div style={{ background: "#F9FAFB", borderRadius: 8, padding: "10px 12px", marginBottom: 10, border: "1px solid #E5E7EB" }}>
                                  <div style={{ fontSize: 11, fontWeight: 600, color: "#9CA3AF", marginBottom: 4 }}>INVITE CODE</div>
                                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                                    <span style={{ fontSize: 22, fontWeight: 800, color: "#3D6B1F", fontFamily: "monospace", letterSpacing: "0.15em" }}>{circle.inviteCode}</span>
                                    <button
                                      onClick={async () => { await navigator.clipboard.writeText(circle.inviteCode); setInviteSent(true); setTimeout(() => setInviteSent(false), 2000); }}
                                      style={{ background: inviteSent ? "#3D6B1F" : "white", border: "1px solid #E5E7EB", borderRadius: 6, padding: "4px 10px", fontFamily: "Inter, sans-serif", fontSize: 12, fontWeight: 600, color: inviteSent ? "white" : "#374151", cursor: "pointer" }}
                                    >{inviteSent ? "✓ Copied!" : "Copy"}</button>
                                  </div>
                                  <div style={{ fontSize: 11.5, color: "#9CA3AF", marginTop: 4 }}>Share this code with parents - they enter it in the "Join a Circle" section</div>
                                </div>
                              )}
                              <div className="invite-or">or share via</div>
                              <div className="invite-share-row">
                                <a className="invite-share-btn" href={`sms:?body=${encodeURIComponent(`Join my ${circle.name} circle on Camplify! Use invite code: ${circle.inviteCode}\n\nSign up at https://camplify.vercel.app`)}`}>Text</a>
                                <a className="invite-share-btn" href={`https://wa.me/?text=${encodeURIComponent(`Join my ${circle.name} circle on Camplify! Use invite code: ${circle.inviteCode}`)}`} target="_blank" rel="noreferrer">WhatsApp</a>
                                <a className="invite-share-btn" href={`mailto:?subject=${encodeURIComponent(`Join ${circle.name} on Camplify`)}&body=${encodeURIComponent(`Hey! Join my ${circle.name} circle on Camplify to share summer camp plans.\n\nUse invite code: ${circle.inviteCode}\n\nSign up or log in at https://camplify.vercel.app`)}`}>Email</a>
                              </div>
                              <button className="invite-cancel" onClick={() => { setInviteCircleId(null); }}>Done</button>
                            </div>
                          ) : (
                            <button className="invite-btn" onClick={e => { e.stopPropagation(); setInviteCircleId(circle.id); setInviteSent(false); }}>
                              + Invite Friends
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                {showAddCircle ? (
                  <div className="add-circle-form">
                    <div style={{ fontFamily: "'Inter', system-ui, sans-serif", fontSize: 16, fontWeight: 700, marginBottom: 12, color: "#3D6B1F" }}>
                      Create a New Circle
                    </div>
                    <input
                      placeholder="e.g. Brighton Elementary 1st grade"
                      value={newCircleName}
                      onChange={(e) => setNewCircleName(e.target.value)}
                      style={{ marginBottom: 12 }}
                    />
                    {kids.length > 0 && (
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "#6B7280", marginBottom: 8 }}>Which kids to include?</div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {kids.map(k => {
                            const on = circleKidIds.has(k.id);
                            return (
                              <button key={k.id}
                                onClick={() => setCircleKidIds(prev => { const next = new Set(prev); on ? next.delete(k.id) : next.add(k.id); return next; })}
                                style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 14px", borderRadius: 20, cursor: "pointer", fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 13, border: `2px solid ${on ? "#3D6B1F" : "#E5E7EB"}`, background: on ? "#3D6B1F" : "white", color: on ? "white" : "#374151", transition: "all 0.12s" }}>
                                <div style={{ width: 22, height: 22, borderRadius: "50%", background: on ? "rgba(255,255,255,0.25)" : "#eef5e8", color: on ? "white" : "#3D6B1F", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800 }}>{k.initials}</div>
                                {k.name}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    <div className="form-btns">
                      <button
                        className="btn-primary"
                        style={{ background: "#3D6B1F" }}
                        disabled={!newCircleName.trim()}
                        onClick={async () => {
                          const newCircle = await createCircle(userId, newCircleName.trim(), "#3D6B1F");
                          // Add creator as member for each selected kid
                          const selectedKidsList = kids.filter(k => circleKidIds.has(k.id));
                          const kidsToAdd = selectedKidsList.length > 0 ? selectedKidsList : kids.slice(0, 1);
                          for (const kid of kidsToAdd) {
                            await joinCircleByCode(userId, userName, kid.name, newCircle.inviteCode).catch(console.error);
                          }
                          // Reload circles to get updated members
                          const updated = await getCircles(userId);
                          setAirtableCircles(updated);
                          setShowAddCircle(false);
                          setNewCircleName("");
                          setCircleKidIds(new Set());
                        }}
                      >
                        Create Circle
                      </button>
                      <button className="btn-ghost" onClick={() => { setShowAddCircle(false); setCircleKidIds(new Set()); }}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button className="add-circle-btn" onClick={() => setShowAddCircle(true)}>
                    + Create a New Circle
                  </button>
                )}

                {/* Join a circle by invite code */}
                {(() => {
                  return (
                    <div style={{ marginTop: 12, padding: "14px 16px", background: "#F9FAFB", borderRadius: 12, border: "1px solid #E5E7EB" }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#374151", marginBottom: 8 }}>Join a Circle</div>
                      <div style={{ fontSize: 12.5, color: "#9CA3AF", marginBottom: 10 }}>Have an invite code? Enter it below to join a circle.</div>
                      <input
                        placeholder="Enter invite code (e.g. ABC123)"
                        value={joinCode}
                        onChange={e => { setJoinCode(e.target.value.toUpperCase()); setJoinError(""); }}
                        style={{ width: "100%", padding: "8px 12px", border: "1.5px solid #E5E7EB", borderRadius: 8, fontFamily: "monospace", fontSize: 13, color: "#1F2937", outline: "none", letterSpacing: "0.1em", marginBottom: 10 }}
                        onFocus={e => e.target.style.borderColor = "#3D6B1F"}
                        onBlur={e => e.target.style.borderColor = "#E5E7EB"}
                      />
                      {kids.length > 1 && joinCode.trim() && (
                        <div style={{ marginBottom: 10 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: "#6B7280", marginBottom: 6 }}>Which kids to include?</div>
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            {kids.map(k => {
                              const on = circleKidIds.has(k.id);
                              return (
                                <button key={k.id}
                                  onClick={() => setCircleKidIds(prev => { const next = new Set(prev); on ? next.delete(k.id) : next.add(k.id); return next; })}
                                  style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 12px", borderRadius: 20, cursor: "pointer", fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 12, border: `2px solid ${on ? "#3D6B1F" : "#E5E7EB"}`, background: on ? "#3D6B1F" : "white", color: on ? "white" : "#374151" }}>
                                  <div style={{ width: 20, height: 20, borderRadius: "50%", background: on ? "rgba(255,255,255,0.25)" : "#eef5e8", color: on ? "white" : "#3D6B1F", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, fontWeight: 800 }}>{k.initials}</div>
                                  {k.name}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      <button
                        disabled={!joinCode.trim() || joinLoading}
                        onClick={async () => {
                          setJoinLoading(true);
                          setJoinError("");
                          const selectedKidsList = kids.filter(k => circleKidIds.has(k.id));
                          const kidsToJoin = selectedKidsList.length > 0 ? selectedKidsList : kids.slice(0, 1);
                          let lastResult = null;
                          if (kidsToJoin.length > 0) {
                            for (const kid of kidsToJoin) {
                              lastResult = await joinCircleByCode(userId, userName, kid.name, joinCode.trim());
                            }
                          } else {
                            // No kids yet - join with just the parent name
                            lastResult = await joinCircleByCode(userId, userName, "", joinCode.trim());
                          }
                          console.log('Join result:', lastResult);
                          if (lastResult?.error) {
                            setJoinError(lastResult.error === "Already a member" ? "You're already in this circle!" : "Invalid invite code. Please check and try again.");
                          } else {
                            // Reload both camps AND circles so friend camps are visible
                            const [updatedCamps, updated] = await Promise.all([
                              getCamps(),
                              getCircles(userId),
                            ]);
                            setAirtableCamps(updatedCamps);
                            setAirtableCircles(updated);
                            setJoinCode("");
                            setCircleKidIds(new Set());
                          }
                          setJoinLoading(false);
                        }}
                        style={{
                          width: "100%", background: "#3D6B1F", border: "none", borderRadius: 8,
                          padding: "9px 16px", fontFamily: "Inter, sans-serif",
                          fontSize: 13, fontWeight: 700, color: "white",
                          cursor: joinCode.trim() ? "pointer" : "not-allowed",
                          opacity: joinCode.trim() ? 1 : 0.4,
                        }}
                      >{joinLoading ? "Joining..." : "Join Circle"}</button>
                      {joinError && <div style={{ fontSize: 12, color: "#DC2626", marginTop: 6 }}>{joinError}</div>}
                    </div>
                  );
                })()}
              </div>
            </>
          )}

          {/* ── ADD CAMP TAB ── */}
          {activeTab === "import" && (
            <>
              {importDone ? (
                <div className="import-success">Camp added successfully!</div>
              ) : (
                <>
                  {/* ── EMAIL FORWARDING CARD ── */}
                  {(() => {
                    const forwardEmail = "add@camps.camplify.app";
                    return (
                      <div style={{
                        background: "#f6faf2", border: "1px solid #c2d9b0",
                        borderRadius: "var(--radius-xl)", padding: "18px 20px",
                        marginBottom: 16, display: "flex", flexDirection: "column", gap: 12,
                        opacity: 0.7, position: "relative", pointerEvents: "none",
                      }}>
                        {/* Coming Soon overlay badge */}
                        <div style={{ position: "absolute", top: 12, right: 14, background: "#3D6B1F", color: "white", fontSize: 10, fontWeight: 700, letterSpacing: "0.5px", textTransform: "uppercase", padding: "3px 8px", borderRadius: 6 }}>
                          Coming Soon
                        </div>
                        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                          <div style={{
                            width: 38, height: 38, borderRadius: 10, flexShrink: 0,
                            background: "#3D6B1F", display: "flex", alignItems: "center", justifyContent: "center",
                          }}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                              <polyline points="22,6 12,13 2,6"/>
                            </svg>
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 700, fontSize: 14, color: "#1F2937", marginBottom: 3 }}>
                              Forward your confirmation email
                            </div>
                            <div style={{ fontSize: 12.5, color: "#6B7280", lineHeight: 1.5 }}>
                              Got a camp registration confirmation? Forward it and we'll automatically add the camp to your schedule.
                            </div>
                          </div>
                        </div>
                        <div style={{
                          background: "white", border: "1px solid #c2d9b0", borderRadius: 8,
                          padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
                        }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5a8f35" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                              <polyline points="22,6 12,13 2,6"/>
                            </svg>
                            <span style={{ fontSize: 13.5, fontWeight: 600, color: "#3D6B1F", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {forwardEmail}
                            </span>
                          </div>
                          <button
                            onClick={async () => {
                              await navigator.clipboard.writeText(forwardEmail);
                              setEmailCopied(true);
                              setTimeout(() => setEmailCopied(false), 2000);
                            }}
                            style={{
                              background: emailCopied ? "#3D6B1F" : "white",
                              border: "1px solid #c2d9b0", borderRadius: 6,
                              padding: "5px 12px", fontFamily: "Inter, sans-serif",
                              fontSize: 12, fontWeight: 600,
                              color: emailCopied ? "white" : "#3D6B1F",
                              cursor: "pointer", transition: "all 0.15s", flexShrink: 0,
                            }}
                          >
                            {emailCopied ? "✓ Copied!" : "Copy"}
                          </button>
                        </div>
                        <div style={{ display: "flex", gap: 20, fontSize: 11.5, color: "#6B7280" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                            <span style={{ color: "#5a8f35", fontWeight: 700 }}>1</span>
                            <span>Get your confirmation email</span>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                            <span style={{ color: "#5a8f35", fontWeight: 700 }}>2</span>
                            <span>Forward it to the address above</span>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                            <span style={{ color: "#5a8f35", fontWeight: 700 }}>3</span>
                            <span>Camp appears in your schedule</span>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* ── DIVIDER ── */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                    <div style={{ flex: 1, height: 1, background: "#e5e7eb" }} />
                    <span style={{ fontSize: 11.5, fontWeight: 600, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.6px" }}>or add manually</span>
                    <div style={{ flex: 1, height: 1, background: "#e5e7eb" }} />
                  </div>

                  {/* ── MANUAL FORM ── */}
                  {(() => { const addMode = "manual"; return (
                    <div className="import-card">
                      <div className="form-grid">

                        <div className="form-field full" style={{ position: "relative" }}>
                          <label className="import-label">Camp Name</label>
                          <input
                            className="form-input"
                            placeholder="e.g. Wilderness Adventure Camp"
                            value={manualForm.name}
                            onChange={e => updateForm("name", e.target.value)}
                            onFocus={() => nameSuggestions.length > 0 && setShowSuggestions(true)}
                            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                            autoComplete="off"
                          />
                          {showSuggestions && (
                            <div className="camp-suggestions">
                              <div className="suggestions-header">Camps your friends are already in</div>
                              {nameSuggestions.map(suggestion => {
                                const friendsInCamp = liveCircles.flatMap(c =>
                                  c.members.filter(m => m.camps.includes(suggestion.id)).map(m => m.child)
                                );
                                return (
                                  <button key={suggestion.id} className="suggestion-item"
                                    onMouseDown={() => {
                                      // Join this camp directly instead of creating a new one
                                      setCampStatus(prev => ({
                                        ...prev,
                                        [suggestion.id]: { ...(prev[suggestion.id] || {}), [importKidId]: importStatus }
                                      }));
                                      setShowSuggestions(false);
                                      setManualForm(prev => ({ ...prev, name: "" }));
                                      setImportDone(true);
                                      setTimeout(() => { setImportDone(false); setActiveTab("weekly"); }, 1800);
                                    }}>
                                    <div className="suggestion-name">
                                      <span className="suggestion-dot" style={{ background: suggestion.color }}></span>
                                      {suggestion.name}
                                    </div>
                                    <div className="suggestion-meta">{suggestion.dates} · {suggestion.location}</div>
                                    <div className="suggestion-friends">
                                      {friendsInCamp.slice(0, 4).join(", ")}{friendsInCamp.length > 4 ? ` +${friendsInCamp.length - 4} more` : ""} going
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>

                        <div className="form-field full">
                          <label className="import-label">Type <span className="optional-tag">optional</span></label>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {[
                              { value: "sports",   label: "⚽ Sports" },
                              { value: "art",      label: "🎨 Art" },
                              { value: "drama",    label: "🎭 Drama" },
                              { value: "outdoors", label: "🌲 Outdoors" },
                              { value: "language", label: "🌍 Language" },
                              { value: "classic",  label: "🏕️ Classic" },
                              { value: "stem",     label: "🔬 STEM" },
                              { value: "music",    label: "🎵 Music" },
                              { value: "gaming",   label: "🎮 Gaming" },
                            ].map(t => (
                              <button key={t.value}
                                type="button"
                                onClick={() => { const cur = Array.isArray(manualForm.campType) ? manualForm.campType : (manualForm.campType ? [manualForm.campType] : []); updateForm("campType", cur.includes(t.value) ? cur.filter(x => x !== t.value) : [...cur, t.value]); }}
                                style={{
                                  background: (Array.isArray(manualForm.campType) ? manualForm.campType : [manualForm.campType]).includes(t.value) ? "#3D6B1F" : "white",
                                  color: (Array.isArray(manualForm.campType) ? manualForm.campType : [manualForm.campType]).includes(t.value) ? "white" : "#374151",
                                  border: `1.5px solid ${(Array.isArray(manualForm.campType) ? manualForm.campType : [manualForm.campType]).includes(t.value) ? "#3D6B1F" : "#E5E7EB"}`,
                                  borderRadius: 7, padding: "6px 12px",
                                  fontFamily: "Inter, sans-serif", fontSize: 12.5, fontWeight: 500,
                                  cursor: "pointer", transition: "all 0.12s",
                                }}
                              >{t.label}</button>
                            ))}
                          </div>
                        </div>

                        <div className="form-field full">
                          <label className="import-label">Website URL</label>
                          <input className="form-input" placeholder="https://campwebsite.com" value={manualForm.url} onChange={e => updateForm("url", e.target.value)} />
                        </div>

                        <div className="form-field">
                          <label className="import-label">Start Date</label>
                          <input type="date" className="form-input" value={manualForm.dateStart} onChange={e => updateForm("dateStart", e.target.value)} />
                        </div>

                        <div className="form-field">
                          <label className="import-label">End Date</label>
                          <input type="date" className="form-input" value={manualForm.dateEnd} onChange={e => updateForm("dateEnd", e.target.value)} />
                        </div>

                        <div className="form-field">
                          <label className="import-label">Neighborhood / City</label>
                          <input className="form-input" placeholder="e.g. Malibu Creek" value={manualForm.location} onChange={e => updateForm("location", e.target.value)} />
                        </div>

                        <div className="form-field">
                          <label className="import-label">Full Address</label>
                          <input className="form-input" placeholder="e.g. 1900 Las Virgenes Rd, Calabasas" value={manualForm.address} onChange={e => updateForm("address", e.target.value)} />
                        </div>

                        {/* Camp hours - start and end time dropdowns */}
                        {(() => {
                          const TIMES = [];
                          for (let h = 7; h <= 18; h++) {
                            for (let m of [0, 30]) {
                              if (h === 18 && m === 30) continue;
                              const ampm = h < 12 ? "AM" : "PM";
                              const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
                              TIMES.push(`${h12}:${m === 0 ? "00" : "30"} ${ampm}`);
                            }
                          }
                          const selectStyle = {
                            width: "100%", padding: "8px 12px", border: "1.5px solid #E5E7EB",
                            borderRadius: 8, fontFamily: "Inter, sans-serif", fontSize: 13,
                            color: "#1F2937", background: "white", outline: "none", cursor: "pointer",
                            appearance: "none",
                            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239CA3AF' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
                            backgroundRepeat: "no-repeat", backgroundPosition: "right 10px center", paddingRight: 32,
                          };
                          return (
                            <>
                              <div className="form-field full">
                                <label className="import-label">Camp Hours</label>
                                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                  <select value={manualForm.timeStart} onChange={e => updateForm("timeStart", e.target.value)} style={selectStyle}
                                    onFocus={e => e.target.style.borderColor = "#3D6B1F"} onBlur={e => e.target.style.borderColor = "#E5E7EB"}>
                                    <option value="">Start time</option>
                                    {TIMES.map(t => <option key={t} value={t}>{t}</option>)}
                                  </select>
                                  <span style={{ color: "#9CA3AF", fontSize: 13, flexShrink: 0 }}>to</span>
                                  <select value={manualForm.timeEnd} onChange={e => updateForm("timeEnd", e.target.value)} style={selectStyle}
                                    onFocus={e => e.target.style.borderColor = "#3D6B1F"} onBlur={e => e.target.style.borderColor = "#E5E7EB"}>
                                    <option value="">End time</option>
                                    {TIMES.map(t => <option key={t} value={t}>{t}</option>)}
                                  </select>
                                </div>
                              </div>

                              {/* Cost */}
                              <div className="form-field full">
                                <label className="import-label">Cost <span className="optional-tag">optional</span></label>
                                <div style={{ position: "relative" }}>
                                  <span style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "#9CA3AF", fontSize: 14, fontWeight: 500, pointerEvents: "none" }}>$</span>
                                  <input className="form-input" type="number" min="0" step="1" placeholder="0" value={manualForm.cost} onChange={e => updateForm("cost", e.target.value)} style={{ paddingLeft: 22 }} />
                                </div>
                              </div>

                              {/* Before care */}
                              <div className="form-field">
                                <label className="import-label">Before Care <span className="optional-tag">optional</span></label>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                  <select value={manualForm.beforeCareStart} onChange={e => updateForm("beforeCareStart", e.target.value)} style={selectStyle}
                                    onFocus={e => e.target.style.borderColor = "#3D6B1F"} onBlur={e => e.target.style.borderColor = "#E5E7EB"}>
                                    <option value="">Start</option>
                                    {TIMES.map(t => <option key={t} value={t}>{t}</option>)}
                                  </select>
                                  <span style={{ color: "#9CA3AF", fontSize: 12, flexShrink: 0 }}>–</span>
                                  <select value={manualForm.beforeCareEnd} onChange={e => updateForm("beforeCareEnd", e.target.value)} style={selectStyle}
                                    onFocus={e => e.target.style.borderColor = "#3D6B1F"} onBlur={e => e.target.style.borderColor = "#E5E7EB"}>
                                    <option value="">End</option>
                                    {TIMES.map(t => <option key={t} value={t}>{t}</option>)}
                                  </select>
                                </div>
                                {(manualForm.beforeCareStart || manualForm.beforeCareEnd) && (
                                  <div style={{ position: "relative", marginTop: 8 }}>
                                    <span style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "#9CA3AF", fontSize: 14, pointerEvents: "none" }}>$</span>
                                    <input className="form-input" type="number" min="0" placeholder="Cost (optional)" value={manualForm.beforeCareCost} onChange={e => updateForm("beforeCareCost", e.target.value)} style={{ paddingLeft: 22 }} />
                                  </div>
                                )}
                              </div>

                              {/* After care */}
                              <div className="form-field">
                                <label className="import-label">After Care <span className="optional-tag">optional</span></label>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                  <select value={manualForm.afterCareStart} onChange={e => updateForm("afterCareStart", e.target.value)} style={selectStyle}
                                    onFocus={e => e.target.style.borderColor = "#3D6B1F"} onBlur={e => e.target.style.borderColor = "#E5E7EB"}>
                                    <option value="">Start</option>
                                    {TIMES.map(t => <option key={t} value={t}>{t}</option>)}
                                  </select>
                                  <span style={{ color: "#9CA3AF", fontSize: 12, flexShrink: 0 }}>–</span>
                                  <select value={manualForm.afterCareEnd} onChange={e => updateForm("afterCareEnd", e.target.value)} style={selectStyle}
                                    onFocus={e => e.target.style.borderColor = "#3D6B1F"} onBlur={e => e.target.style.borderColor = "#E5E7EB"}>
                                    <option value="">End</option>
                                    {TIMES.map(t => <option key={t} value={t}>{t}</option>)}
                                  </select>
                                </div>
                                {(manualForm.afterCareStart || manualForm.afterCareEnd) && (
                                  <div style={{ position: "relative", marginTop: 8 }}>
                                    <span style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "#9CA3AF", fontSize: 14, pointerEvents: "none" }}>$</span>
                                    <input className="form-input" type="number" min="0" placeholder="Cost (optional)" value={manualForm.afterCareCost} onChange={e => updateForm("afterCareCost", e.target.value)} style={{ paddingLeft: 22 }} />
                                  </div>
                                )}
                              </div>
                            </>
                          );
                        })()}

                        <div className="form-field full">
                          <label className="import-label">Discount Code <span className="optional-tag">optional</span></label>
                          <input className="form-input" placeholder="e.g. SUMMER25" value={manualForm.discountCode} onChange={e => updateForm("discountCode", e.target.value)} style={{ fontFamily: "monospace", letterSpacing: "0.05em", textTransform: "uppercase" }} />
                        </div>

                        <div className="form-field full">
                          <label className="import-label">Notes <span className="optional-tag">optional</span></label>
                          <textarea className="form-input" placeholder="e.g. Bring sunscreen, pick up at side gate..." rows={3} value={manualForm.notes} onChange={e => updateForm("notes", e.target.value)} style={{ resize: "vertical" }} />
                        </div>

                        {/* Age or Grade selector */}
                        {(() => {
                          const AGES = Array.from({length: 17}, (_, i) => i + 2); // 2–18
                          const GRADES = ["Pre-K", "K", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th", "11th", "12th"];
                          const selectStyle = {
                            width: "100%", padding: "8px 12px", border: "1.5px solid #E5E7EB",
                            borderRadius: 8, fontFamily: "Inter, sans-serif", fontSize: 13,
                            color: "#1F2937", background: "white", outline: "none", cursor: "pointer",
                            appearance: "none",
                            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239CA3AF' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
                            backgroundRepeat: "no-repeat", backgroundPosition: "right 10px center", paddingRight: 32,
                          };
                          const isAge = manualForm.ageOrGrade === "age";
                          return (
                            <div className="form-field full">
                              <label className="import-label">Age / Grade Range <span className="optional-tag">optional</span></label>
                              {/* Toggle */}
                              <div style={{ display: "flex", gap: 0, background: "#F3F4F6", borderRadius: 8, padding: 3, width: "fit-content", marginBottom: 10 }}>
                                {[["age","By Age"],["grade","By Grade"]].map(([val, lbl]) => (
                                  <button key={val}
                                    onClick={() => updateForm("ageOrGrade", val)}
                                    style={{
                                      background: manualForm.ageOrGrade === val ? "white" : "transparent",
                                      border: "none", borderRadius: 6, padding: "5px 14px",
                                      fontFamily: "Inter, sans-serif", fontSize: 12.5, fontWeight: 600,
                                      color: manualForm.ageOrGrade === val ? "#1F2937" : "#9CA3AF",
                                      cursor: "pointer",
                                      boxShadow: manualForm.ageOrGrade === val ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                                      transition: "all 0.12s",
                                    }}
                                  >{lbl}</button>
                                ))}
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                {isAge ? (
                                  <>
                                    <select value={manualForm.ageMin} onChange={e => updateForm("ageMin", e.target.value)} style={selectStyle}
                                      onFocus={e => e.target.style.borderColor = "#3D6B1F"} onBlur={e => e.target.style.borderColor = "#E5E7EB"}>
                                      <option value="">Min age</option>
                                      {AGES.map(a => <option key={a} value={a}>{a} years</option>)}
                                    </select>
                                    <span style={{ color: "#9CA3AF", fontSize: 13, flexShrink: 0 }}>to</span>
                                    <select value={manualForm.ageMax} onChange={e => updateForm("ageMax", e.target.value)} style={selectStyle}
                                      onFocus={e => e.target.style.borderColor = "#3D6B1F"} onBlur={e => e.target.style.borderColor = "#E5E7EB"}>
                                      <option value="">Max age</option>
                                      {AGES.map(a => <option key={a} value={a}>{a} years</option>)}
                                    </select>
                                  </>
                                ) : (
                                  <>
                                    <select value={manualForm.gradeMin} onChange={e => updateForm("gradeMin", e.target.value)} style={selectStyle}
                                      onFocus={e => e.target.style.borderColor = "#3D6B1F"} onBlur={e => e.target.style.borderColor = "#E5E7EB"}>
                                      <option value="">Min grade</option>
                                      {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
                                    </select>
                                    <span style={{ color: "#9CA3AF", fontSize: 13, flexShrink: 0 }}>to</span>
                                    <select value={manualForm.gradeMax} onChange={e => updateForm("gradeMax", e.target.value)} style={selectStyle}
                                      onFocus={e => e.target.style.borderColor = "#3D6B1F"} onBlur={e => e.target.style.borderColor = "#E5E7EB"}>
                                      <option value="">Max grade</option>
                                      {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
                                    </select>
                                  </>
                                )}
                              </div>
                            </div>
                          );
                        })()}

                        <div className="form-field full">
                          <label className="import-label">Days camp runs</label>
                          <div style={{ fontSize: 11.5, color: "#9CA3AF", marginBottom: 6 }}>Which days of the week does this camp meet?</div>
                          <div className="days-picker-row">
                            {["M","T","W","Th","F"].map(d => (
                              <button key={d}
                                className={`day-picker-btn${manualForm.days.includes(d) ? " active" : ""}`}
                                onClick={() => toggleFormDay(d)}
                              >{d}</button>
                            ))}
                          </div>
                        </div>

                      </div>
                      <div className="form-btns" style={{ marginTop: 20 }}>
                        {duplicateMatch && (
                          <div className="duplicate-warning">
                            <div className="dup-icon">⚠️</div>
                            <div className="dup-body">
                              <div className="dup-title">Possible duplicate</div>
                              <div className="dup-sub"><strong>{duplicateMatch.name}</strong> is already in the app - added by a friend in your liveCircles. Want to add yourself to that camp instead?</div>
                              <div className="dup-actions">
                                <button className="btn-primary" style={{ fontSize: 12, padding: "7px 14px" }} onClick={() => {
                                  setCampStatus(prev => ({ ...prev, [duplicateMatch.id]: { ...(prev[duplicateMatch.id] || {}), [importKidId]: importStatus } }));
                                  setDuplicateMatch(null);
                                  setManualForm({ name: "", dateStart: "", dateEnd: "", location: "", address: "", timeStart: "", timeEnd: "", beforeCareStart: "", beforeCareEnd: "", beforeCareCost: "", afterCareStart: "", afterCareEnd: "", afterCareCost: "", url: "", discountCode: "", notes: "", days: [], ageMin: "", ageMax: "", gradeMin: "", gradeMax: "", ageOrGrade: "age", cost: "", campType: "" });
                                  setImportDone(true);
                                  setTimeout(() => { setImportDone(false); setActiveTab("weekly"); }, 1800);
                                }}>Join existing camp</button>
                                <button className="btn-ghost" style={{ fontSize: 12, padding: "7px 14px" }} onClick={() => {
                                  setDuplicateMatch(null);
                                  const id = nextCampId();
                                  const color = CAMP_COLORS[dynamicCamps.length % CAMP_COLORS.length];
                                  const ds = manualForm.dateStart;
                                  const de = manualForm.dateEnd || ds;
                                  const getMon2 = (dateStr) => { const d = new Date(dateStr + "T12:00:00"); const dow = d.getDay(); d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1)); return d.toISOString().slice(0, 10); };
                                  const wr = [];
                                  if (ds) { const cur = new Date(getMon2(ds) + "T12:00:00"); const endD = new Date((de||ds) + "T12:00:00"); while (cur <= endD) { wr.push(cur.toISOString().slice(0,10)); cur.setDate(cur.getDate()+7); } }
                                  const week = wr[0] || getMon2(new Date().toISOString().slice(0,10));
                                  const formatDate = (iso) => { if (!iso) return ""; const d = new Date(iso + "T12:00:00"); return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }); };
                                  const dates = ds && de ? `${formatDate(ds)}–${formatDate(de)}` : ds ? formatDate(ds) : "";
                                  const newCamp = { id, color, emoji: "", name: manualForm.name, url: manualForm.url||"", dates, dateStart: ds, dateEnd: de, location: manualForm.location, address: manualForm.address, hours: manualForm.hours, beforeCare: manualForm.beforeCare, afterCare: manualForm.afterCare, discountCode: manualForm.discountCode, notes: manualForm.notes, days: manualForm.days.length ? manualForm.days : ["M","T","W","Th","F"], week, weekRange: wr.length ? wr : [1] };
                                  setDynamicCamps(prev => [...prev, newCamp]);
                                  setCampStatus(prev => ({ ...prev, [id]: { [importKidId]: importStatus } }));
                                  setManualForm({ name: "", dateStart: "", dateEnd: "", location: "", address: "", timeStart: "", timeEnd: "", beforeCareStart: "", beforeCareEnd: "", beforeCareCost: "", afterCareStart: "", afterCareEnd: "", afterCareCost: "", url: "", discountCode: "", notes: "", days: [], ageMin: "", ageMax: "", gradeMin: "", gradeMax: "", ageOrGrade: "age", cost: "", campType: "" });
                                  setImportDone(true);
                                  setTimeout(() => { setImportDone(false); setActiveTab("weekly"); }, 1800);
                                }}>Add anyway</button>
                              </div>
                            </div>
                          </div>
                        )}
                        <button className="btn-primary" onClick={submitManualForm} disabled={!manualForm.name.trim() || importDone}>{importDone ? "Saving..." : "Add Camp"}</button>
                      </div>
                    </div>
                  ); })()}

                  {false && (
                    <div className="import-card">
                      {!parsedCamp ? (
                        <>
                          <label className="import-label">Paste your confirmation email below</label>
                          <textarea
                            className="import-textarea"
                            placeholder={"Example:\n\nDear Parent,\n\nThank you for registering for Space Science Camp!\nDates: July 13–17\nLocation: 1200 E California Blvd, Pasadena\nHours: 8:00 AM – 3:00 PM\nDays: Monday, Wednesday, Friday\n\nWe look forward to seeing your child!"}
                            value={emailText}
                            onChange={e => setEmailText(e.target.value)}
                            rows={10}
                          />
                          <button className="btn-primary" style={{ marginTop: 12, opacity: parsing ? 0.6 : 1 }}
                            onClick={parseEmail} disabled={parsing || !emailText.trim()}>
                            {parsing ? "Parsing email..." : "Parse Email"}
                          </button>
                          {parseError && <div className="import-error">{parseError}</div>}
                        </>
                      ) : (
                        <>
                          <div className="import-preview-label">We found this camp:</div>
                          <div className="import-preview-card" style={{ borderLeftColor: CAMP_COLORS[dynamicCamps.length % CAMP_COLORS.length] }}>
                            <div className="import-preview-name">{parsedCamp.name}</div>
                            <div className="import-preview-meta">{parsedCamp.location}{parsedCamp.address ? ` · ${parsedCamp.address}` : ""}</div>
                            <div className="import-preview-meta">{parsedCamp.dates} · {parsedCamp.hours}</div>
                            {parsedCamp.days?.length > 0 && (
                              <div className="camp-days-row" style={{ marginTop: 10 }}>
                                {["M","T","W","Th","F"].map(d => (
                                  <span key={d} className={`camp-day${parsedCamp.days.includes(d) ? " camp-day-on" : ""}`}
                                    style={parsedCamp.days.includes(d) ? { background: CAMP_COLORS[dynamicCamps.length % CAMP_COLORS.length], borderColor: CAMP_COLORS[dynamicCamps.length % CAMP_COLORS.length] } : {}}>
                                    {d}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="import-assign">
                            <div className="import-assign-row">
                              <label className="import-label">Add for:</label>
                              <div style={{ display: "flex", gap: 8 }}>
                                {kids.map(kid => (
                                  <button key={kid.id} className="sibling-toggle"
                                    style={{ background: importKidId === kid.id ? "#4F46E5" : "white", color: importKidId === kid.id ? "white" : "#4F46E5", borderColor: "#4F46E5" }}
                                    onClick={() => setImportKidId(kid.id)}>
                                    <span className="sibling-initials-bubble" style={{ background: importKidId === kid.id ? "rgba(255,255,255,0.25)" : "#EEF2FF", color: importKidId === kid.id ? "white" : "#4F46E5" }}>{kid.initials}</span>
                                    {kid.name}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <div className="import-assign-row">
                              <label className="import-label">Status:</label>
                              <div style={{ display: "flex", gap: 8 }}>
                                {["enrolled","thinking","waitlist"].map(s => (
                                  <button key={s} onClick={() => setImportStatus(s)} style={{
                                    background: importStatus === s ? STATUS_CONFIG[s].bg : "white",
                                    color: importStatus === s ? "white" : STATUS_CONFIG[s].bg,
                                    borderColor: STATUS_CONFIG[s].bg, border: "2px solid", borderRadius: 20,
                                    padding: "5px 14px", fontFamily: "'Nunito', sans-serif", fontWeight: 800,
                                    fontSize: 13, cursor: "pointer", transition: "all 0.15s",
                                    display: "inline-flex", alignItems: "center", gap: 6,
                                  }}>
                                    <StatusIcon s={s} size={12} color={importStatus === s ? "white" : STATUS_CONFIG[s].bg} />
                                    {STATUS_CONFIG[s].label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>
                          <div className="form-btns" style={{ marginTop: 16 }}>
                            <button className="btn-primary" onClick={confirmImport}>Add to My Camps</button>
                            <button className="btn-ghost" onClick={() => setParsedCamp(null)}>Try Again</button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </main>

        {/* ── STATUS BOTTOM SHEET ── */}
        {openPicker && (
          <div className="bottom-sheet-overlay" onClick={closeStatusPicker}>
            <div className="bottom-sheet" onClick={e => e.stopPropagation()}>
              <div className="bottom-sheet-handle" />
              <div className="bottom-sheet-title">
                {openPicker.kidName} · <span style={{ fontWeight: 600, color: "#888" }}>{openPicker.campName}</span>
              </div>
              {["enrolled","thinking","waitlist"].map(s => (
                <button key={s}
                  className={`bottom-sheet-option${openPicker.currentStatus === s ? " selected" : ""}`}
                  style={{ "--opt-color": STATUS_CONFIG[s].bg }}
                  onClick={() => { setStatus(openPicker.campId, openPicker.kidId, s); closeStatusPicker(); }}>
                  <span className="bottom-sheet-icon" style={{ background: STATUS_CONFIG[s].bg + "22", color: STATUS_CONFIG[s].bg }}>
                    <StatusIcon s={s} size={16} color={STATUS_CONFIG[s].bg} />
                  </span>
                  <span className="bottom-sheet-option-label">{STATUS_CONFIG[s].label}</span>
                  {openPicker.currentStatus === s && <span className="bottom-sheet-check">✓</span>}
                </button>
              ))}
              <button className="bottom-sheet-option bottom-sheet-remove"
                onClick={() => { removeStatus(openPicker.campId, openPicker.kidId); closeStatusPicker(); }}>
                <span className="bottom-sheet-icon" style={{ background: "#f5f5f0", color: "#c0392b" }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                </span>
                <span className="bottom-sheet-option-label" style={{ color: "#c0392b" }}>Remove from camp</span>
              </button>
              <button className="bottom-sheet-cancel" onClick={closeStatusPicker}>Cancel</button>
            </div>
          </div>
        )}

        {/* ── ENROLLMENT MODAL ── */}
        {enrollModal && (() => {
          const camp = [...camps, ...airtableCamps, ...dynamicCamps].find(c => c.id === enrollModal.campId);
          const kid = kids.find(k => k.id === enrollModal.kidId);
          if (!camp || !kid) return null;
          const campDays = camp.days || ["M","T","W","Th","F"];
          return (
            <div className="modal-overlay" onClick={() => setEnrollModal(null)}>
              <div className="modal-card" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                  <div className="modal-title">Adding {kid.name} to</div>
                  <div className="modal-camp-name" style={{ color: camp.color }}>{camp.name}</div>
                </div>

                {/* Camp schedule - read only */}
                <div className="modal-section">
                  <div className="modal-label">Camp schedule</div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    {["M","T","W","Th","F"].map(d => (
                      <span key={d} style={{
                        width: 32, height: 32, borderRadius: 7,
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                        fontSize: 12, fontWeight: 700,
                        background: campDays.includes(d) ? camp.color + "22" : "#F3F4F6",
                        color: campDays.includes(d) ? camp.color : "#D1D5DB",
                        border: `1.5px solid ${campDays.includes(d) ? camp.color + "55" : "#E5E7EB"}`,
                      }}>{d}</span>
                    ))}
                    {camp.hours && (
                      <span style={{ fontSize: 11.5, color: "#6B7280", marginLeft: 4 }}>{camp.hours}</span>
                    )}
                  </div>
                </div>

                {/* Weeks selector - only shown for multi-week camps */}
                {(() => {
                  // Generate camp weeks directly from camp's own dates
                  const getCampWeeks = (camp) => {
                    if (!camp.dateStart) return computedWeeks.filter(w => campInWeek(camp, w.num));
                    const fmt = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                    const weeks = [];
                    const start = new Date(camp.dateStart + "T12:00:00");
                    const end = camp.dateEnd ? new Date(camp.dateEnd + "T12:00:00") : start;
                    const cur = new Date(start);
                    const dow = cur.getDay();
                    cur.setDate(cur.getDate() - (dow === 0 ? 6 : dow - 1));
                    while (cur <= end) {
                      const iso = cur.toISOString().slice(0, 10);
                      const fri = new Date(cur); fri.setDate(fri.getDate() + 4);
                      weeks.push({ num: iso, dates: fmt(cur) + "–" + fmt(fri) });
                      cur.setDate(cur.getDate() + 7);
                    }
                    return weeks;
                  };
                  const campAllWeeks = getCampWeeks(camp);
                  if (campAllWeeks.length <= 1) return null;
                  return (
                    <div className="modal-section">
                      <div className="modal-label">Weeks {kid.name} is attending</div>
                      <div style={{ fontSize: 11.5, color: "#9CA3AF", marginBottom: 8 }}>
                        This camp runs {campAllWeeks.length} weeks - select which ones
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {campAllWeeks.map(w => {
                          const selected = enrollWeeks.includes(w.num);
                          return (
                            <button key={w.num}
                              onClick={() => setEnrollWeeks(prev => prev.includes(w.num) ? prev.filter(x => x !== w.num) : [...prev, w.num])}
                              style={{
                                display: "flex", alignItems: "center", gap: 10,
                                padding: "8px 12px", borderRadius: 8, cursor: "pointer",
                                border: `1.5px solid ${selected ? camp.color : "#E5E7EB"}`,
                                background: selected ? camp.color + "12" : "white",
                                fontFamily: "Inter, sans-serif", textAlign: "left",
                                transition: "all 0.12s",
                              }}
                            >
                              <div style={{
                                width: 18, height: 18, borderRadius: 5, flexShrink: 0,
                                border: `2px solid ${selected ? camp.color : "#D1D5DB"}`,
                                background: selected ? camp.color : "white",
                                display: "flex", alignItems: "center", justifyContent: "center",
                              }}>
                                {selected && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                              </div>
                              <div>
                                <div style={{ fontSize: 13, fontWeight: 600, color: selected ? camp.color : "#374151" }}>{w.dates}</div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                      <button
                        onClick={() => setEnrollWeeks(prev => prev.length === campAllWeeks.length ? [] : campAllWeeks.map(w => w.num))}
                        style={{ marginTop: 6, background: "none", border: "none", fontFamily: "Inter, sans-serif", fontSize: 11.5, fontWeight: 600, color: camp.color, cursor: "pointer", padding: 0 }}
                      >
                        {enrollWeeks.length === campAllWeeks.length ? "Deselect all" : "Select all weeks"}
                      </button>
                    </div>
                  );
                })()}

                {/* Kid's attending days - selectable, constrained to camp days */}
                <div className="modal-section">
                  <div className="modal-label">Days {kid.name} is attending</div>
                  <div style={{ fontSize: 11.5, color: "#9CA3AF", marginBottom: 8 }}>
                    Select which days {kid.name} will go
                  </div>
                  <div className="days-picker-row">
                    {["M","T","W","Th","F"].map(d => {
                      const campHasDay = campDays.includes(d);
                      const kidHasDay = enrollDays.includes(d);
                      return (
                        <button key={d}
                          className={`day-picker-btn${kidHasDay ? " active" : ""}${!campHasDay ? " day-picker-unavailable" : ""}`}
                          onClick={() => {
                            if (!campHasDay) return;
                            setEnrollDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]);
                          }}
                          title={!campHasDay ? "Camp doesn't run this day" : ""}
                        >{d}</button>
                      );
                    })}
                  </div>
                  {campDays.length < 5 && (
                    <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 6 }}>
                      Grayed days not available - camp only runs {campDays.join(", ")}
                    </div>
                  )}
                </div>

                {/* Status */}
                <div className="modal-section">
                  <div className="modal-label">Status</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {["enrolled","thinking","waitlist"].map(s => (
                      <button key={s} onClick={() => setEnrollModal(m => ({ ...m, status: s }))} style={{
                        background: enrollModal.status === s ? STATUS_CONFIG[s].bg : "white",
                        color: enrollModal.status === s ? "white" : STATUS_CONFIG[s].bg,
                        borderColor: STATUS_CONFIG[s].bg, border: "2px solid", borderRadius: 20,
                        padding: "5px 12px", fontFamily: "Inter, sans-serif", fontWeight: 700,
                        fontSize: 12, cursor: "pointer", transition: "all 0.15s",
                        display: "inline-flex", alignItems: "center", gap: 5,
                      }}>
                        <StatusIcon s={s} size={11} color={enrollModal.status === s ? "white" : STATUS_CONFIG[s].bg} />
                        {STATUS_CONFIG[s].label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="modal-section">
                  <div className="modal-label">Extended care</div>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <button className={`care-toggle-btn${enrollBeforeCare ? " active" : ""}`}
                      onClick={() => setEnrollBeforeCare(v => !v)}
                      disabled={!camp.beforeCare}>
                      <span style={{ fontWeight: 900 }}>☀</span> Before Care
                      {camp.beforeCare && <span className="care-time">{camp.beforeCare}</span>}
                      {!camp.beforeCare && <span className="care-na">not offered</span>}
                    </button>
                    <button className={`care-toggle-btn${enrollAfterCare ? " active" : ""}`}
                      onClick={() => setEnrollAfterCare(v => !v)}
                      disabled={!camp.afterCare}>
                      <span style={{ fontWeight: 900 }}>🌙</span> After Care
                      {camp.afterCare && <span className="care-time">{camp.afterCare}</span>}
                      {!camp.afterCare && <span className="care-na">not offered</span>}
                    </button>
                  </div>
                </div>

                <div className="modal-footer">
                  <button className="btn-primary" onClick={confirmEnroll} disabled={enrollDays.length === 0}>
                    Add {kid.name}
                  </button>
                  <button className="btn-ghost" onClick={() => setEnrollModal(null)}>Cancel</button>
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    </>
  );
}