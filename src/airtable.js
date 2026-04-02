import Airtable from 'airtable';

const base = new Airtable({
  apiKey: import.meta.env.VITE_AIRTABLE_TOKEN
}).base(import.meta.env.VITE_AIRTABLE_BASE_ID);

// Get the Monday ISO date string for a given date
const getMondayIso = (dateStr) => {
  const d = new Date(dateStr + 'T12:00:00');
  const dow = d.getDay();
  d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
  return d.toISOString().slice(0, 10);
};

export const getWeekRange = (dateStart, dateEnd) => {
  if (!dateStart) return [getMondayIso(new Date().toISOString().slice(0,10))];
  const start = new Date(dateStart + 'T12:00:00');
  const end = dateEnd ? new Date(dateEnd + 'T12:00:00') : start;
  const mondays = [];
  const cur = new Date(start);
  const dow = cur.getDay();
  cur.setDate(cur.getDate() - (dow === 0 ? 6 : dow - 1));
  while (cur <= end) {
    mondays.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 7);
  }
  return mondays.length > 0 ? mondays : [getMondayIso(dateStart)];
};

export const getWeekNum = (dateStart) => {
  if (!dateStart) return null;
  return getMondayIso(dateStart);
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
      dateStart,
      dateEnd,
      dates: formatDates(dateStart, dateEnd),
      location: f.Location || '',
      address: f.Address || '',
      hours,
      beforeCare,
      beforeCareCost: f['BeforeCare Cost'] || null,
      afterCare,
      afterCareCost: f['AfterCare Cost'] || null,
      campType: Array.isArray(f.Type) ? f.Type.map(t => t.toLowerCase()) : (f.Type ? [f.Type.toLowerCase()] : []),
      days: f.Days || [],
      ageMin: f.AgeMin || null,
      ageMax: f.AgeMax || null,
      gradeMin: f.GradeMin || '',
      gradeMax: f.GradeMax || '',
      cost: f.Cost || null,
      url: f.URL || '',
      color: '#3D6B1F',
      emoji: '',
      week,
      weekRange,
      userId: f.UserId || '',
    };
  });
};

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
      name,
      initials,
      age: f.Age || '',
      interests: (f.Interests || []).map(i => i.toLowerCase()),
      zipcode: f.Zipcode || '',
      visible: f.Visible || false,
      bio: f.Bio || '',
      bffs: f.BFFs ? f.BFFs.split(',').filter(Boolean) : [],
      camps: [],
    };
  });
};

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
    bffs: [],
    camps: [],
  };
};

export const updateKid = async (kidId, fields) => {
  const airtableFields = {};
  if (fields.name !== undefined) airtableFields.Name = fields.name;
  if (fields.age !== undefined) airtableFields.Age = fields.age ? Number(fields.age) : null;
  if (fields.initials !== undefined) airtableFields.Initials = fields.initials;
  if (fields.interests !== undefined) airtableFields.Interests = Array.from(fields.interests).map(i => i === 'stem' ? 'STEM' : i.charAt(0).toUpperCase() + i.slice(1));
  if (fields.zipcode !== undefined) airtableFields.Zipcode = fields.zipcode;
  if (fields.visible !== undefined) airtableFields.Visible = fields.visible;
  if (fields.bio !== undefined) airtableFields.Bio = fields.bio;
  if (fields.bffs !== undefined) airtableFields.BFFs = fields.bffs.join(',');
  await base('Kids').update(kidId, airtableFields);
};

// Load all enrollments for a list of kid IDs
export const getEnrollments = async (kidIds) => {
  if (!kidIds || kidIds.length === 0) return [];
  try {
    // Load all enrollments and filter client-side (simpler than complex Airtable formulas)
    const records = await base('Enrollments').select().all();
    const kidIdSet = new Set(kidIds);
    return records
      .filter(r => r.fields.Kid && kidIdSet.has(r.fields.Kid[0]))
      .map(r => {
        const f = r.fields;
        return {
          id: r.id,
          kidId: f.Kid ? f.Kid[0] : '',
          campId: f.Camp ? f.Camp[0] : '',
          status: f.Status || '',
          days: f.Days || [],
          beforeCare: f.BeforeCare || false,
          afterCare: f.AfterCare || false,
          weeks: f.Weeks ? f.Weeks.split(',').filter(Boolean) : [],
        };
      });
  } catch (e) {
    console.error('Error loading enrollments:', e);
    return [];
  }
};

// Save a new enrollment
export const saveEnrollment = async (kidId, campId, status, days, beforeCare, afterCare, weeks) => {
  const record = await base('Enrollments').create({
    Kid: [kidId],
    Camp: [campId],
    Status: status,
    Days: days || [],
    BeforeCare: beforeCare || false,
    AfterCare: afterCare || false,
    Weeks: weeks && weeks.length > 0 ? weeks.join(',') : '',
  });
  return record.id;
};

// Update an existing enrollment
export const updateEnrollment = async (enrollmentId, status, days, beforeCare, afterCare, weeks) => {
  await base('Enrollments').update(enrollmentId, {
    Status: status,
    Days: days || [],
    BeforeCare: beforeCare || false,
    AfterCare: afterCare || false,
    Weeks: weeks && weeks.length > 0 ? weeks.join(',') : '',
  });
};

// Delete an enrollment
export const deleteEnrollment = async (enrollmentId) => {
  await base('Enrollments').destroy(enrollmentId);
};

// Load breaks for a list of kid IDs
export const getBreaks = async (kidIds) => {
  if (!kidIds || kidIds.length === 0) return [];
  try {
    const records = await base('Breaks').select().all();
    const kidIdSet = new Set(kidIds);
    return records
      .filter(r => r.fields.Kid && kidIdSet.has(r.fields.Kid[0]))
      .map(r => ({
        id: r.id,
        kidId: r.fields.Kid[0],
        weekIso: r.fields.WeekIso || '',
        label: r.fields.Label || 'Break',
      }));
  } catch (e) {
    console.error('Error loading breaks:', e);
    return [];
  }
};

// Save a break
export const saveBreak = async (kidId, weekIso, label) => {
  const record = await base('Breaks').create({
    Kid: [kidId],
    WeekIso: weekIso,
    Label: label || 'Break',
  });
  return record.id;
};

// Update a break label
export const updateBreak = async (breakId, label) => {
  await base('Breaks').update(breakId, { Label: label || 'Break' });
};

// Delete a break
export const deleteBreak = async (breakId) => {
  await base('Breaks').destroy(breakId);
};

// Update an existing camp
export const updateCamp = async (campId, fields) => {
  const airtableFields = {};
  if (fields.name !== undefined) airtableFields.Name = fields.name;
  if (fields.dateStart !== undefined) airtableFields.DateStart = fields.dateStart || null;
  if (fields.dateEnd !== undefined) airtableFields.DateEnd = fields.dateEnd || null;
  if (fields.location !== undefined) airtableFields.Location = fields.location;
  if (fields.address !== undefined) airtableFields.Address = fields.address;
  if (fields.timeStart !== undefined) airtableFields.TimeStart = fields.timeStart || null;
  if (fields.timeEnd !== undefined) airtableFields.TimeEnd = fields.timeEnd || null;
  if (fields.beforeCareStart !== undefined) airtableFields.BeforeCareStart = fields.beforeCareStart || null;
  if (fields.beforeCareEnd !== undefined) airtableFields.BeforeCareEnd = fields.beforeCareEnd || null;
  if (fields.beforeCareCost !== undefined) airtableFields['BeforeCare Cost'] = fields.beforeCareCost ? Number(fields.beforeCareCost) : null;
  if (fields.afterCareStart !== undefined) airtableFields.AfterCareStart = fields.afterCareStart || null;
  if (fields.afterCareEnd !== undefined) airtableFields.AfterCareEnd = fields.afterCareEnd || null;
  if (fields.afterCareCost !== undefined) airtableFields['AfterCare Cost'] = fields.afterCareCost ? Number(fields.afterCareCost) : null;
  if (fields.campType !== undefined) airtableFields.Type = Array.isArray(fields.campType) ? fields.campType.filter(Boolean).map(t => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()).map(t => t === 'Stem' ? 'STEM' : t) : [];
  if (fields.days !== undefined) airtableFields.Days = (fields.days || []).filter(Boolean);
  if (fields.ageMin !== undefined) airtableFields.AgeMin = fields.ageMin ? Number(fields.ageMin) : null;
  if (fields.ageMax !== undefined) airtableFields.AgeMax = fields.ageMax ? Number(fields.ageMax) : null;
  if (fields.gradeMin !== undefined) airtableFields.GradeMin = fields.gradeMin || null;
  if (fields.gradeMax !== undefined) airtableFields.GradeMax = fields.gradeMax || null;
  if (fields.cost !== undefined) airtableFields.Cost = fields.cost ? Number(fields.cost) : null;
  if (fields.url !== undefined) airtableFields.URL = fields.url;
  await base('Camps').update(campId, airtableFields);
};

// Save a new camp to Airtable
export const saveCamp = async (userId, fields) => {
  const airtableFields = {
    Name: fields.name,
    UserId: userId,
  };
  if (fields.dateStart) airtableFields.DateStart = fields.dateStart;
  if (fields.dateEnd) airtableFields.DateEnd = fields.dateEnd;
  if (fields.location) airtableFields.Location = fields.location;
  if (fields.address) airtableFields.Address = fields.address;
  if (fields.timeStart) airtableFields.TimeStart = fields.timeStart;
  if (fields.timeEnd) airtableFields.TimeEnd = fields.timeEnd;
  if (fields.beforeCareStart) airtableFields.BeforeCareStart = fields.beforeCareStart;
  if (fields.beforeCareEnd) airtableFields.BeforeCareEnd = fields.beforeCareEnd;
  if (fields.beforeCareCost) airtableFields['BeforeCare Cost'] = Number(fields.beforeCareCost);
  if (fields.afterCareStart) airtableFields.AfterCareStart = fields.afterCareStart;
  if (fields.afterCareEnd) airtableFields.AfterCareEnd = fields.afterCareEnd;
  if (fields.afterCareCost) airtableFields['AfterCare Cost'] = Number(fields.afterCareCost);
  if (fields.ageMin) airtableFields.AgeMin = Number(fields.ageMin);
  if (fields.ageMax) airtableFields.AgeMax = Number(fields.ageMax);
  if (fields.gradeMin) airtableFields.GradeMin = fields.gradeMin;
  if (fields.gradeMax) airtableFields.GradeMax = fields.gradeMax;
  if (fields.cost) airtableFields.Cost = Number(fields.cost);
  if (fields.url) airtableFields.URL = fields.url;
  const campType = Array.isArray(fields.campType) ? fields.campType : (fields.campType ? [fields.campType] : []);
  if (campType.length > 0) airtableFields.Type = campType.map(t => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()).map(t => t === 'Stem' ? 'STEM' : t);
  const days = fields.days || [];
  if (days.length > 0) airtableFields.Days = days;
  const record = await base('Camps').create(airtableFields);
  return record.id;
};

// Generate a random invite code
const generateCode = () => Math.random().toString(36).substring(2, 8).toUpperCase();

// Load all circles the user belongs to (as creator or member)
export const getCircles = async (userId) => {
  try {
    // Get all circle memberships for this user
    const memberships = await base('CircleMembers').select({
      filterByFormula: `{UserId} = '${userId}'`
    }).all();

    const circleIds = [...new Set(memberships.flatMap(r => r.fields.Circle || []))];

    // Also get circles created by this user
    const createdCircles = await base('Circles').select({
      filterByFormula: `{CreatedBy} = '${userId}'`
    }).all();

    const createdIds = new Set(createdCircles.map(r => r.id));
    const allIds = [...new Set([...circleIds, ...createdIds])];

    if (allIds.length === 0) return [];

    // Load all circles
    const allCircles = await base('Circles').select().all().then(all =>
      all.filter(r => allIds.includes(r.id))
    );

    // Load all members for these circles
    const allMembers = await base('CircleMembers').select().all();

    // Load all enrollments, breaks and kids to show friends' full schedule
    const allEnrollments = await base('Enrollments').select().all();
    const allKids = await base('Kids').select().all();
    const allBreaks = await base('Breaks').select().all();

    return allCircles.map(r => ({
      id: r.id,
      name: r.fields.Name || '',
      color: r.fields.Color || '#3D6B1F',
      inviteCode: r.fields.InviteCode || '',
      createdBy: r.fields.CreatedBy || '',
      members: allMembers
        .filter(m => (m.fields.Circle || []).includes(r.id))
        .map(m => {
          const memberUserId = m.fields.UserId || '';
          const childName = m.fields.ChildName || '';
          // Find all kids for this user
          const memberKids = allKids.filter(k => k.fields.UserId === memberUserId);
          // Find the specific kid this CircleMembers record is for (by name match)
          // Match kid by exact name first, then by first name only if unambiguous
          const exactMatch = memberKids.find(k => k.fields.Name === childName);
          const firstNameMatches = memberKids.filter(k => k.fields.Name?.split(' ')[0] === childName?.split(' ')[0]);
          const specificKid = exactMatch || (firstNameMatches.length === 1 ? firstNameMatches[0] : null);
          // Only visible if the specific kid has Visible === true
          const isVisible = specificKid ? specificKid.fields.Visible === true : false;
          // Only use visible kids for camp/break lookups
          const visibleMemberKids = specificKid && isVisible ? [specificKid] : [];
          const memberKidIds = new Set(visibleMemberKids.map(k => k.id));
          // Find camps they're enrolled in
          const memberEnrollments = allEnrollments
            .filter(e => e.fields.Kid && memberKidIds.has(e.fields.Kid[0]));
          const memberCampIds = memberEnrollments
            .map(e => e.fields.Camp ? e.fields.Camp[0] : null)
            .filter(Boolean);
          // Build weeks map: campId -> enrolled weeks
          const memberCampWeeks = {};
          // Build status map: campId -> status
          const memberCampStatus = {};
          memberEnrollments.forEach(e => {
            const campId = e.fields.Camp ? e.fields.Camp[0] : null;
            if (campId) {
              memberCampWeeks[campId] = e.fields.Weeks ? e.fields.Weeks.split(',').filter(Boolean) : [];
              memberCampStatus[campId] = e.fields.Status || 'enrolled';
            }
          });
          // Find this member's breaks
          const memberBreaks = allBreaks
            .filter(b => b.fields.Kid && memberKidIds.has(b.fields.Kid[0]))
            .map(b => ({
              weekIso: b.fields.WeekIso || '',
              label: b.fields.Label || 'Break',
            }));
          const hasVisibleKid = isVisible;
          return {
            id: m.id,
            userId: memberUserId,
            name: m.fields.ParentName || '',
            child: m.fields.ChildName || '',
            camps: memberCampIds,
            campWeeks: memberCampWeeks,
            campStatus: memberCampStatus,
            breaks: memberBreaks,
            visible: hasVisibleKid,
            profile: specificKid ? {
              age: specificKid.fields.Age || '',
              bio: specificKid.fields.Bio || '',
              zipcode: specificKid.fields.Zipcode || '',
              interests: specificKid.fields.Interests || [],
              visible: specificKid.fields.Visible === true,
            } : {},
          };
        }),
    }));
  } catch (e) {
    console.error('Error loading circles:', e);
    return [];
  }
};

// Create a new circle
export const createCircle = async (userId, name, color) => {
  const inviteCode = generateCode();
  const record = await base('Circles').create({
    Name: name,
    Color: color || '#3D6B1F',
    CreatedBy: userId,
    InviteCode: inviteCode,
  });
  return {
    id: record.id,
    name: record.fields.Name,
    color: record.fields.Color,
    inviteCode: record.fields.InviteCode,
    createdBy: record.fields.CreatedBy,
    members: [],
  };
};

// Update a circle's name
export const updateCircle = async (circleId, name) => {
  await base('Circles').update(circleId, { Name: name });
};

// Join a circle by invite code
export const joinCircleByCode = async (userId, parentName, childName, inviteCode) => {
  // Find circle with this code
  const circles = await base('Circles').select({
    filterByFormula: `{InviteCode} = '${inviteCode}'`
  }).all();

  if (circles.length === 0) return { error: 'Circle not found' };
  const circle = circles[0];

  // Check if already a member with this child
  const existing = await base('CircleMembers').select({
    filterByFormula: `AND({UserId} = '${userId}', {ChildName} = '${childName}')`
  }).all().then(all => all.filter(r => (r.fields.Circle || []).includes(circle.id)));

  if (existing.length > 0) return { error: 'Already a member' };

  // Add as member
  await base('CircleMembers').create({
    Circle: [circle.id],
    UserId: userId,
    ParentName: parentName || '',
    ChildName: childName || '',
    Joined: new Date().toISOString().slice(0, 10),
  });

  return {
    id: circle.id,
    name: circle.fields.Name,
    color: circle.fields.Color,
    inviteCode: circle.fields.InviteCode,
    createdBy: circle.fields.CreatedBy,
    members: [],
  };
};

// Update CircleMembers records that have empty ChildName for this user
export const updateCircleMemberKid = async (userId, childName) => {
  try {
    const records = await base('CircleMembers').select({
      filterByFormula: `AND({UserId} = '${userId}', {ChildName} = '')`
    }).all();
    for (const r of records) {
      await base('CircleMembers').update(r.id, { ChildName: childName });
    }
  } catch (e) {
    console.error('Error updating circle member kid:', e);
  }
};

// Update parent name in all CircleMembers records for this user
export const updateParentName = async (userId, parentName) => {
  try {
    const records = await base('CircleMembers').select({
      filterByFormula: `{UserId} = '${userId}'`
    }).all();
    for (const r of records) {
      await base('CircleMembers').update(r.id, { ParentName: parentName });
    }
  } catch (e) {
    console.error('Error updating parent name:', e);
  }
};

// Load important dates for a list of kid IDs
export const getImportantDates = async (kidIds) => {
  if (!kidIds || kidIds.length === 0) return [];
  try {
    const records = await base('ImportantDates').select().all();
    const kidIdSet = new Set(kidIds);
    const filtered = records.filter(r => r.fields.Kid && kidIdSet.has(r.fields.Kid[0]));
    return filtered.map(r => ({
      id: r.id,
      kidId: r.fields.Kid[0],
      label: r.fields.Label || '',
      dateStart: r.fields.DateStart || '',
      dateEnd: r.fields.DateEnd || '',
    }));
  } catch (e) {
    console.error('Error loading important dates:', e);
    return [];
  }
};

// Save a new important date
export const saveImportantDate = async (kidId, label, dateStart, dateEnd) => {
  const record = await base('ImportantDates').create({
    Kid: [kidId],
    Label: label,
    DateStart: dateStart || null,
    DateEnd: dateEnd || null,
  });
  return {
    id: record.id,
    kidId: kidId,
    label: record.fields.Label || '',
    dateStart: record.fields.DateStart || '',
    dateEnd: record.fields.DateEnd || '',
  };
};

// Delete an important date
export const deleteImportantDate = async (dateId) => {
  await base('ImportantDates').destroy(dateId);
};

// ── REVIEWS ──

export const getReviews = async (campIds) => {
  if (!campIds || campIds.length === 0) return [];
  try {
    let records;
    try { records = await base('Reviews').select().all(); }
    catch (tableErr) { return []; } // Table may not exist yet
    return records
      .filter(r => r.fields.Camp && campIds.includes(r.fields.Camp[0]))
      .map(r => ({
        id: r.id,
        campId: r.fields.Camp ? r.fields.Camp[0] : '',
        userId: r.fields.UserId || '',
        authorName: r.fields.AuthorName || '',
        authorChild: r.fields.AuthorChild || '',
        rating: r.fields.Rating || 0,
        text: r.fields.Text || '',
        date: r.fields.Date || '',
      }));
  } catch (e) {
    console.error('Error loading reviews:', e);
    return [];
  }
};

export const saveReview = async (campId, userId, authorName, authorChild, rating, text) => {
  const record = await base('Reviews').create({
    Camp: [campId],
    UserId: userId,
    AuthorName: authorName,
    AuthorChild: authorChild,
    Rating: rating,
    Text: text,
    Date: new Date().toISOString().slice(0, 10),
  });
  return {
    id: record.id,
    campId,
    userId,
    authorName,
    authorChild,
    rating,
    text,
    date: record.fields.Date || new Date().toISOString().slice(0, 10),
  };
};

export const deleteReview = async (reviewId) => {
  await base('Reviews').destroy(reviewId);
};