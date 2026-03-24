import Airtable from 'airtable';

const base = new Airtable({
  apiKey: import.meta.env.VITE_AIRTABLE_TOKEN
}).base(import.meta.env.VITE_AIRTABLE_BASE_ID);

export const getCamps = async () => {
  const records = await base('Camps').select().all();
  return records.map(r => ({
    id: r.id,
    name: r.fields.Name || '',
    dates: r.fields.Dates || '',
    location: r.fields.Location || '',
    address: r.fields.Address || '',
    hours: r.fields.Hours || '',
    campType: r.fields.Type || '',
    cost: r.fields.Cost || null,
    url: r.fields.URL || '',
  }));
};

export const getKids = async () => {
  const records = await base('Kids').select().all();
  return records.map(r => ({
    id: r.id,
    name: r.fields.Name || '',
    age: r.fields.Age || '',
    interests: r.fields.Interests || [],
    zipcode: r.fields.Zipcode || '',
    visible: r.fields.Visible || false,
    bio: r.fields.Bio || '',
  }));
};

export const getEnrollments = async () => {
  const records = await base('Enrollments').select().all();
  return records.map(r => ({
    id: r.id,
    kidId: r.fields.Kid?.[0] || '',
    campId: r.fields.Camp?.[0] || '',
    status: r.fields.Status || '',
    days: r.fields.Days || [],
  }));
};

export const saveEnrollment = async (kidId, campId, status, days) => {
  return base('Enrollments').create({
    Kid: [kidId],
    Camp: [campId],
    Status: status,
    Days: days,
  });
};