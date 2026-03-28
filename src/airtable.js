import Airtable from 'airtable';

const base = new Airtable({
  apiKey: import.meta.env.VITE_AIRTABLE_TOKEN
}).base(import.meta.env.VITE_AIRTABLE_BASE_ID);

const WEEK_DEFINITIONS = [
  { num: 0, start: '2026-06-08', end: '2026-06-11' },
  { num: 6, start: '2026-06-15', end: '2026-06-18' },
  { num: 1, start: '2026-06-22', end: '2026-06-26' },
  { num: 2, start: '2026-06-29', end: '2026-07-03' },
  { num: 3, start: '2026-07-06', end: '2026-07-10' },
  { num: 4, start: '2026-07-13', end: '2026-07-17' },
  { num: 5, start: '2026-07-20', end: '2026-07-24' },
];

export const getWeekRange = (dateStart, dateEnd) => {
  if (!dateStart) return [1];
  const start = new Date(dateStart + 'T12:00:00');
  const end = dateEnd ? new Date(dateEnd + 'T12:00:00') : start;
  const overlapping = WEEK_DEFINITIONS.filter(w => {
    const wStart = new Date(w.start + 'T00:00:00');
    const wEnd = new Date(w.end + 'T23:59:59');
    return start <= wEnd && end >= wStart;
  });
  return overlapping.length > 0 ? overlapping.map(w => w.num) : [1];
};

export const getWeekNum = (dateStart) => {
  const range = getWeekRange(dateStart, dateStart);
  return range[0];
};

const formatDate = (dateStr) => {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const formatDates = (dateStart, dateEnd) => {
  if (!dateStart) return '';
  if (!dateEnd || dateStart === dateEnd) return formatDate(dateStart);
  return formatDate(dateStart) + ' - ' + formatDate(dateEnd);
};

export const getCamps = async () => {
  const records = await base('Camps').select().all();
  return records.map(r => {
    const f = r.fields;
    const dateStart = f.DateStart || '';
    const dateEnd = f.DateEnd || '';
    const weekRange = getWeekRange(dateStart, dateEnd);
    const week = weekRange[0];
    const hours = f.TimeStart && f.TimeEnd ? f.TimeStart + ' - ' + f.TimeEnd : '';
    const beforeCare = f.BeforeCareStart && f.BeforeCareEnd ? f.BeforeCareStart + ' - ' + f.BeforeCareEnd : '';
    const afterCare = f.AfterCareStart && f.AfterCareEnd ? f.AfterCareStart + ' - ' + f.AfterCareEnd : '';
    return {
      id: r.id,
      name: f.Name || '',
      dateStart: dateStart,
      dateEnd: dateEnd,
      dates: formatDates(dateStart, dateEnd),
      location: f.Location || '',
      address: f.Address || '',
      hours: hours,
      beforeCare: beforeCare,
      beforeCareCost: f['BeforeCare Cost'] || null,
      afterCare: afterCare,
      afterCareCost: f['AfterCare Cost'] || null,
      campType: f.Type || '',
      days: f.Days || [],
      ageMin: f.AgeMin || null,
      ageMax: f.AgeMax || null,
      gradeMin: f.GradeMin || '',
      gradeMax: f.GradeMax || '',
      cost: f.Cost || null,
      url: f.URL || '',
      color: '#3D6B1F',
      emoji: '',
      week: week,
      weekRange: weekRange,
    };
  });
};

// Load kids filtered by userId
export const getKids = async (userId) => {
  const records = await base('Kids')
    .select({ filterByFormula: `{UserId} = '${userId}'` })
    .all();
  return records.map(r => {
    const f = r.fields;
    const name = f.Name || '';
    const initials = f.Initials || name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    return {
      id: r.id,
      name: name,
      initials: initials,
      age: f.Age || '',
      interests: f.Interests || [],
      zipcode: f.Zipcode || '',
      visible: f.Visible || false,
      bio: f.Bio || '',
      camps: [],
    };
  });
};

// Save a new kid to Airtable
export const saveKid = async (userId, name, initials) => {
  const record = await base('Kids').create({
    Name: name,
    Initials: initials,
    UserId: userId,
  });
  return {
    id: record.id,
    name: record.fields.Name || '',
    initials: record.fields.Initials || '',
    age: '',
    interests: [],
    zipcode: '',
    visible: false,
    bio: '',
    camps: [],
  };
};

// Update kid profile fields
export const updateKid = async (kidId, fields) => {
  const airtableFields = {};
  if (fields.age !== undefined) airtableFields.Age = fields.age ? Number(fields.age) : null;
  if (fields.initials !== undefined) airtableFields.Initials = fields.initials;
  if (fields.interests !== undefined) airtableFields.Interests = Array.from(fields.interests);
  if (fields.zipcode !== undefined) airtableFields.Zipcode = fields.zipcode;
  if (fields.visible !== undefined) airtableFields.Visible = fields.visible;
  if (fields.bio !== undefined) airtableFields.Bio = fields.bio;
  await base('Kids').update(kidId, airtableFields);
};

export const getEnrollments = async () => {
  const records = await base('Enrollments').select().all();
  return records.map(r => {
    const f = r.fields;
    return {
      id: r.id,
      kidId: f.Kid ? f.Kid[0] : '',
      campId: f.Camp ? f.Camp[0] : '',
      status: f.Status || '',
      days: f.Days || [],
    };
  });
};

export const saveEnrollment = async (kidId, campId, status, days) => {
  return base('Enrollments').create({
    Kid: [kidId],
    Camp: [campId],
    Status: status,
    Days: days,
  });
};