const express = require('express');
const db = require('../config/db');

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.session?.user?.id) {
    return res.status(401).json({ success: false, message: 'Please log in.' });
  }

  return next();
}

router.use(requireAuth);

function requireAdmin(req, res, next) {
  if (req.session?.user?.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin only.' });
  }

  return next();
}

router.get('/meta/filters', async (req, res) => {
  try {
    const [types] = await db.query(
      'SELECT DISTINCT type FROM resources WHERE type IS NOT NULL AND type <> "" ORDER BY type ASC'
    );
    const [buildings] = await db.query(
      `SELECT DISTINCT b.code, b.name
       FROM resources r
       LEFT JOIN buildings b ON r.building_id = b.id
       WHERE b.code IS NOT NULL
       ORDER BY b.name ASC`
    );
    const [summaryRows] = await db.query(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN is_open = 1 THEN 1 ELSE 0 END) AS open_count,
              SUM(CASE WHEN is_open = 0 THEN 1 ELSE 0 END) AS closed_count
       FROM resources`
    );
    const [typeBreakdown] = await db.query(
      `SELECT type, COUNT(*) AS count
       FROM resources
       GROUP BY type
       ORDER BY count DESC`
    );
    const [buildingBreakdown] = await db.query(
      `SELECT COALESCE(b.name, 'Unassigned') AS building_name, COUNT(*) AS count
       FROM resources r
       LEFT JOIN buildings b ON r.building_id = b.id
       GROUP BY COALESCE(b.name, 'Unassigned')
       ORDER BY count DESC`
    );

    return res.json({
      success: true,
      data: {
        types: (types || []).map((row) => row.type),
        buildings: buildings || [],
        summary: {
          total: summaryRows[0]?.total || 0,
          open: summaryRows[0]?.open_count || 0,
          closed: summaryRows[0]?.closed_count || 0
        },
        typeBreakdown: typeBreakdown || [],
        buildingBreakdown: buildingBreakdown || []
      }
    });
  } catch (err) {
    console.error('Resources meta error:', err);
    return res.status(500).json({ success: false, message: `Server error: ${err.message}` });
  }
});

router.get('/admin/buildings', requireAdmin, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, code, name, location, description, status, updated_at
       FROM buildings
       ORDER BY name ASC`
    );

    return res.json({ success: true, data: rows || [] });
  } catch (err) {
    console.error('Admin resource buildings error:', err);
    return res.status(500).json({ success: false, message: `Server error: ${err.message}` });
  }
});

router.get('/', async (req, res) => {
  try {
    let sql = `
      SELECT r.id, r.name, r.type, r.floor_number, r.description, r.is_open,
             r.contact_info, r.timings, r.capacity, r.equipment,
             b.code AS building_code, b.name AS building_name, b.location AS building_location
      FROM resources r
      LEFT JOIN buildings b ON r.building_id = b.id
      WHERE 1=1
    `;
    const params = [];

    if (req.query.type) {
      sql += ' AND LOWER(r.type) = LOWER(?)';
      params.push(req.query.type);
    }

    if (req.query.building_code) {
      sql += ' AND b.code = ?';
      params.push(req.query.building_code);
    }

    if (req.query.only_open === 'true') {
      sql += ' AND r.is_open = 1';
    }

    if (req.query.search) {
      const search = `%${String(req.query.search).trim()}%`;
      sql += ' AND (r.name LIKE ? OR r.type LIKE ? OR r.description LIKE ? OR b.name LIKE ? OR b.code LIKE ?)';
      params.push(search, search, search, search, search);
    }

    sql += ' ORDER BY r.name';

    const [rows] = await db.query(sql, params);
    return res.json({ success: true, data: rows || [] });
  } catch (err) {
    console.error('Resources list error:', err);
    return res.status(500).json({ success: false, message: `Server error: ${err.message}` });
  }
});

router.post('/', requireAdmin, async (req, res) => {
  try {
    const {
      building_id,
      name,
      type,
      floor_number,
      description,
      is_open,
      contact_info,
      timings,
      capacity,
      equipment
    } = req.body || {};

    const cleanName = String(name || '').trim();
    const cleanType = String(type || '').trim();
    const buildingId = parseInt(building_id, 10);

    if (!cleanName || !cleanType || Number.isNaN(buildingId)) {
      return res.status(400).json({
        success: false,
        message: 'Building, resource name, and type are required.'
      });
    }

    const [buildings] = await db.query('SELECT id FROM buildings WHERE id = ? LIMIT 1', [buildingId]);
    if (!buildings?.length) {
      return res.status(404).json({ success: false, message: 'Selected building was not found.' });
    }

    const safeCapacity = capacity === '' || capacity === null || typeof capacity === 'undefined'
      ? null
      : parseInt(capacity, 10);

    const [result] = await db.query(
      `INSERT INTO resources
       (building_id, name, type, floor_number, description, is_open, contact_info, timings, capacity, equipment)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        buildingId,
        cleanName,
        cleanType,
        String(floor_number || '').trim() || null,
        String(description || '').trim() || null,
        is_open === false || is_open === 'false' || Number(is_open) === 0 ? 0 : 1,
        String(contact_info || '').trim() || null,
        String(timings || '').trim() || null,
        Number.isNaN(safeCapacity) ? null : safeCapacity,
        String(equipment || '').trim() || null
      ]
    );

    return res.json({ success: true, message: 'Resource created.', id: result.insertId });
  } catch (err) {
    console.error('Resource create error:', err);
    return res.status(500).json({ success: false, message: `Server error: ${err.message}` });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ success: false, message: 'Invalid resource id.' });
    }

    const [rows] = await db.query(
      `SELECT r.id, r.name, r.type, r.floor_number, r.description, r.is_open,
              r.contact_info, r.timings, r.capacity, r.equipment,
              b.id AS building_id, b.code AS building_code, b.name AS building_name,
              b.location AS building_location, b.description AS building_description
       FROM resources r
       LEFT JOIN buildings b ON r.building_id = b.id
       WHERE r.id = ?`,
      [id]
    );

    if (!rows?.length) {
      return res.status(404).json({ success: false, message: 'Resource not found.' });
    }

    const resource = rows[0];
    return res.json({
      success: true,
      data: {
        id: resource.id,
        name: resource.name,
        type: resource.type,
        building_id: resource.building_id,
        building_code: resource.building_code,
        building_name: resource.building_name,
        building_location: resource.building_location,
        building_description: resource.building_description || '',
        floor_number: resource.floor_number || '',
        description: resource.description || '',
        is_open: Boolean(resource.is_open),
        contact_info: resource.contact_info || '',
        timings: resource.timings || '',
        capacity: resource.capacity || null,
        equipment: resource.equipment || ''
      }
    });
  } catch (err) {
    console.error('Resource detail error:', err);
    return res.status(500).json({ success: false, message: `Server error: ${err.message}` });
  }
});

router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ success: false, message: 'Invalid resource id.' });
    }

    const {
      building_id,
      name,
      type,
      floor_number,
      description,
      is_open,
      contact_info,
      timings,
      capacity,
      equipment
    } = req.body || {};

    const cleanName = String(name || '').trim();
    const cleanType = String(type || '').trim();
    const buildingId = parseInt(building_id, 10);

    if (!cleanName || !cleanType || Number.isNaN(buildingId)) {
      return res.status(400).json({
        success: false,
        message: 'Building, resource name, and type are required.'
      });
    }

    const [buildings] = await db.query('SELECT id FROM buildings WHERE id = ? LIMIT 1', [buildingId]);
    if (!buildings?.length) {
      return res.status(404).json({ success: false, message: 'Selected building was not found.' });
    }

    const safeCapacity = capacity === '' || capacity === null || typeof capacity === 'undefined'
      ? null
      : parseInt(capacity, 10);

    const [result] = await db.query(
      `UPDATE resources
       SET building_id = ?, name = ?, type = ?, floor_number = ?, description = ?,
           is_open = ?, contact_info = ?, timings = ?, capacity = ?, equipment = ?
       WHERE id = ?`,
      [
        buildingId,
        cleanName,
        cleanType,
        String(floor_number || '').trim() || null,
        String(description || '').trim() || null,
        is_open === false || is_open === 'false' || Number(is_open) === 0 ? 0 : 1,
        String(contact_info || '').trim() || null,
        String(timings || '').trim() || null,
        Number.isNaN(safeCapacity) ? null : safeCapacity,
        String(equipment || '').trim() || null,
        id
      ]
    );

    if (!result.affectedRows) {
      return res.status(404).json({ success: false, message: 'Resource not found.' });
    }

    return res.json({ success: true, message: 'Resource updated.' });
  } catch (err) {
    console.error('Resource update error:', err);
    return res.status(500).json({ success: false, message: `Server error: ${err.message}` });
  }
});

router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ success: false, message: 'Invalid resource id.' });
    }

    const [result] = await db.query('DELETE FROM resources WHERE id = ?', [id]);
    if (!result.affectedRows) {
      return res.status(404).json({ success: false, message: 'Resource not found.' });
    }

    return res.json({ success: true, message: 'Resource deleted.' });
  } catch (err) {
    console.error('Resource delete error:', err);
    return res.status(500).json({ success: false, message: `Server error: ${err.message}` });
  }
});

module.exports = router;
