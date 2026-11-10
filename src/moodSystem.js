/**
 * Mood System — Sistem Dinamika Mood & Kesehatan Alami Callista.
 *
 * Menggantikan mekanisme mood lama (pengaruh diusir/mute dihapus).
 * Mood Callista kini dipengaruhi secara independen oleh 3 sistem riil:
 * 1. Tekanan Jadwal (Kepadatan Akademik & Tugas DKV dari collegeRoadmap)
 * 2. Sistem Sakit (Sick System: Alergi Debu, Pilek, Sariawan, Demam [maks 3 hari])
 * 3. Siklus Menstruasi (PMS, Haid Hari 1-2 Kram Berat, Haid Lanjutan, Variasi ±2 hari)
 *
 * Tabrakan ketiga agenda ini dapat menurunkan mood hingga ambang batas bawah (< 28),
 * yang menyebabkan Callista jarang/tidak memakai "wkwk", lebih sensitif, mudah tersinggung,
 * tidak peka pada lelucon, dan sesekali curhat/sambat alami.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const collegeRoadmap = require('./collegeRoadmap');

const HEALTH_FILE = path.resolve(__dirname, '../data/health_state.json');

const ILLNESS_CONFIG = {
  alergi: {
    id: 'alergi',
    name: 'Alergi Debu',
    category: 'mild',
    minDays: 1,
    maxDays: 2,
    penalty: 10,
    weight: 40,
    symptoms: 'Bersin-bersin dan hidung gatal karena alergi debu kamar/studio',
    complaints: [
      'debu studio dkv ga ngotak jir, hidung langsung gatal bersin-bersin mulu :',
      'mata gatal bgt kena debu kamar, alergi kambuh lagi...',
      'alergi debu kambuh, bersin mulu dari tadi pagi :'
    ]
  },
  pilek: {
    id: 'pilek',
    name: 'Pilek / Flu',
    category: 'mild',
    minDays: 3,
    maxDays: 6,
    penalty: 18,
    weight: 30,
    symptoms: 'Hidung mampet sebelah/meler, suara bindeng, kepala agak berat',
    complaints: [
      'mana hidung mampet dua-duanya, tisu di kamar sampe abis :',
      'suara gue bindeng bgt gara-gara flu, males bgt ngomong :',
      'flu melanda lagi... kepala berat pengen rebahan seharian aja'
    ]
  },
  sariawan: {
    id: 'sariawan',
    name: 'Sariawan',
    category: 'mild',
    minDays: 2,
    maxDays: 4,
    penalty: 12,
    weight: 20,
    symptoms: 'Sariawan di bibir/lidah, perih saat makan pedas atau minum es',
    complaints: [
      'bibir sariawan gede bgt, makan pedes dikit langsung perih :',
      'lagi sariawan di lidah, males ngomong banyak perih bgt...',
      'sariawan ga sembuh-sembuh, mau minum es aja ngilu :'
    ]
  },
  demam: {
    id: 'demam',
    name: 'Demam Meriang',
    category: 'severe',
    minDays: 1,
    maxDays: 3, // Batas mutlak: TIDAK BOLEH seminggu!
    penalty: 35,
    weight: 10,
    symptoms: 'Badan meriang panas dingin, lemas menggigil di kasur',
    complaints: [
      'badan meriang anget bgt, menggigil di bawah selimut dari tadi...',
      'demam bikin lemes parah, ga sanggup buka laptop sama sekali :',
      'kepala pusing bgt meriang, mau gerak aja ga ada tenaga...'
    ]
  }
};

const MENSTRUATION_CONFIG = {
  baselineCycle: 28,
  minCycle: 26,
  maxCycle: 30,
  minPeriod: 4,
  maxPeriod: 7,
  phases: {
    pms: {
      name: 'Fase PMS',
      penalty: 20,
      description: 'Perut begah/kembung, pinggang pegal, mood swing sensitif',
      complaints: [
        'bawaannya pengen marah-marah mulu, lagi pms kali ya...',
        'pinggang pegel banget sama perut begah, sensitif bgt hari ini :',
        'kalo punya pacar enak ya ngeluh kalo lagi begini :'
      ]
    },
    haid_heavy: {
      name: 'Haid Hari 1-2 (Dismenore / Kram Berat)',
      penalty: 35,
      description: 'Kram perut hebat, nyeri panggul, lemas dan sangat sensitif',
      complaints: [
        'kalo punya pacar enak ya ngeluh kalo lg haid gini :',
        'perut keram banget dari tadi subuh, mager ngapa-ngapain :',
        'kram perut ga ketulungan, butuh kompres anget sama rebahan seharian...',
        'lagi hari pertama haid, senggol bacok bgt asli jangan bikin emosi :'
      ]
    },
    haid_light: {
      name: 'Haid Lanjutan (Hari 3+)',
      penalty: 12,
      description: 'Darah berkurang, kram mereda tapi badan masih lemas dan mager',
      complaints: [
        'masih lemes sisa haid, mager ngapa-ngapain bawaannya...',
        'kram perut udah mendingan tapi badan masih berasa capek bgt :'
      ]
    }
  }
};

function parseDateStr(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function formatDateStr(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(dateStr, days) {
  const d = parseDateStr(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return formatDateStr(d);
}

function daysDiff(dateStr1, dateStr2) {
  const d1 = parseDateStr(dateStr1);
  const d2 = parseDateStr(dateStr2);
  return Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getDefaultHealthState(dateStr = '2026-11-10') {
  return {
    version: '1.0.0',
    timezone: 'Asia/Jakarta',
    last_updated: dateStr,
    situational_delta: 0,
    sick_system: {
      active_illnesses: [
        {
          id: 'illness_pilek_' + dateStr,
          type: 'pilek',
          name: 'Pilek / Flu',
          started_at: addDays(dateStr, -1),
          ends_at: addDays(dateStr, 3),
          duration_days: 5,
          symptoms: ILLNESS_CONFIG.pilek.symptoms,
          penalty: ILLNESS_CONFIG.pilek.penalty
        }
      ],
      history: [
        {
          type: 'alergi',
          name: 'Alergi Debu',
          started_at: addDays(dateStr, -12),
          ends_at: addDays(dateStr, -10),
          duration_days: 2
        },
        {
          type: 'sariawan',
          name: 'Sariawan',
          started_at: addDays(dateStr, -22),
          ends_at: addDays(dateStr, -19),
          duration_days: 3
        }
      ],
      last_roll_date: dateStr
    },
    menstrual_cycle: {
      cycle_length_days: 28,
      period_duration_days: 5,
      last_period_start: addDays(dateStr, -26),
      last_period_end: addDays(dateStr, -21),
      next_expected_start: addDays(dateStr, 1), // Besok mulai haid (hari ini PMS)
      variance_days: -1,
      history: [
        {
          start_date: addDays(dateStr, -54),
          end_date: addDays(dateStr, -49),
          duration_days: 5,
          cycle_length: 28
        },
        {
          start_date: addDays(dateStr, -26),
          end_date: addDays(dateStr, -21),
          duration_days: 5,
          cycle_length: 28
        }
      ]
    }
  };
}

function loadHealthState(currentDateStr = null) {
  try {
    if (fs.existsSync(HEALTH_FILE)) {
      const raw = fs.readFileSync(HEALTH_FILE, 'utf8');
      const data = JSON.parse(raw);
      if (data && data.sick_system && data.menstrual_cycle) {
        return data;
      }
    }
  } catch (err) {
    console.error('[MOOD_SYSTEM] Gagal membaca health_state.json:', err.message);
  }

  const def = getDefaultHealthState(currentDateStr || '2026-11-10');
  saveHealthState(def);
  return def;
}

function saveHealthState(data) {
  const tmpFile = `${HEALTH_FILE}.tmp`;
  try {
    fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmpFile, HEALTH_FILE);
    return true;
  } catch (err) {
    try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch (_) {}
    console.error('[MOOD_SYSTEM] Gagal menyimpan health_state.json:', err.message);
    return false;
  }
}

/**
 * 1. Evaluasi Tekanan Jadwal Akademik (Academic Schedule Pressure)
 */
function getAcademicPressure(dateStr, roadmap = null) {
  const rMap = roadmap || collegeRoadmap.loadRoadmap();
  const acadStatus = collegeRoadmap.getAcademicStatus(dateStr, rMap);

  if (acadStatus.status === 'on_break' || acadStatus.status === 'holiday') {
    return {
      pressureScore: 5,
      penalty: 0,
      bonus: 5,
      level: 'Libur / Bebas Santai',
      summary: acadStatus.status === 'on_break' ? 'Libur jeda antar semester (tidak ada kuliah)' : 'Hari libur kalender',
      classesCount: 0,
      urgentAssignmentsCount: 0
    };
  }

  if (acadStatus.status === 'exam_period') {
    return {
      pressureScore: 90,
      penalty: 30,
      bonus: 0,
      level: 'Kritis (Masa Ujian UTS/UAS)',
      summary: 'Periode Ujian Semester — Stres tinggi & beban belajar penuh',
      classesCount: 0,
      urgentAssignmentsCount: 0
    };
  }

  if (acadStatus.status === 'preparing_next_semester') {
    return {
      pressureScore: 35,
      penalty: 10,
      bonus: 0,
      level: 'Masa Registrasi KRS',
      summary: 'Pengisian KRS Online & Bimbingan DPA',
      classesCount: 0,
      urgentAssignmentsCount: 0
    };
  }

  // Ongoing semester classes
  const classesToday = collegeRoadmap.getClassesForDate(dateStr, rMap);
  const activeAssignments = collegeRoadmap.getActiveAssignments(dateStr, rMap);

  let classPenalty = 0;
  if (classesToday.length === 1) classPenalty = 6;
  else if (classesToday.length === 2) classPenalty = 14;
  else if (classesToday.length >= 3) classPenalty = 22;

  // Studio / Lab course modifier
  const studioCount = classesToday.filter(c => c.type === 'studio' || c.type === 'practice').length;
  classPenalty += studioCount * 3;

  // Assignment pressure
  let assignmentPenalty = 0;
  let urgentCount = 0;

  activeAssignments.forEach(a => {
    if (!a.dueDate) return;
    const diff = daysDiff(dateStr, a.dueDate);
    if (diff === 0) {
      // Due today!
      assignmentPenalty += (a.priority === 'urgent' || a.priority === 'high') ? 15 : 10;
      urgentCount++;
    } else if (diff === 1) {
      // Due tomorrow!
      assignmentPenalty += (a.priority === 'urgent' || a.priority === 'high') ? 12 : 8;
      urgentCount++;
    } else if (diff >= 2 && diff <= 3) {
      assignmentPenalty += (a.priority === 'urgent' || a.priority === 'high') ? 6 : 4;
    }
  });

  assignmentPenalty = Math.min(22, assignmentPenalty);
  const totalPenalty = Math.min(35, classPenalty + assignmentPenalty);
  const pressureScore = Math.min(100, Math.round((totalPenalty / 35) * 100));

  let level = 'Ringan / Santai';
  if (pressureScore >= 70) level = 'Padat & Melelahkan';
  else if (pressureScore >= 40) level = 'Sedang / Normal';

  const parts = [];
  if (classesToday.length > 0) parts.push(`${classesToday.length} kelas kuliah (${classesToday.map(c => c.courseName).join(', ')})`);
  if (urgentCount > 0) parts.push(`${urgentCount} tugas deadline dekat`);
  if (parts.length === 0) parts.push('Tidak ada jadwal kuliah hari ini');

  return {
    pressureScore,
    penalty: totalPenalty,
    bonus: 0,
    level,
    summary: parts.join(' • '),
    classesCount: classesToday.length,
    urgentAssignmentsCount: urgentCount
  };
}

/**
 * 2. Evaluasi Sistem Sakit (Sick System)
 */
function evaluateSickSystem(dateStr, healthData, persist = true) {
  const sick = healthData.sick_system || { active_illnesses: [], history: [], last_roll_date: dateStr };
  let active = sick.active_illnesses || [];
  let history = sick.history || [];
  let modified = false;

  // A. Bersihkan sakit yang sudah lewat tanggal sembuh (ends_at < dateStr)
  const stillActive = [];
  active.forEach(item => {
    if (item.ends_at < dateStr) {
      history.unshift({
        type: item.type,
        name: item.name,
        started_at: item.started_at,
        ends_at: item.ends_at,
        duration_days: item.duration_days || daysDiff(item.started_at, item.ends_at) + 1
      });
      modified = true;
    } else {
      stillActive.push(item);
    }
  });
  if (history.length > 20) history = history.slice(0, 20);
  active = stillActive;

  // B. Cek jarak terakhir kali sakit (guard: tidak boleh > 14 hari tanpa sakit sama sekali)
  let lastSickEnd = dateStr;
  if (history.length > 0 && history[0].ends_at) {
    lastSickEnd = history[0].ends_at;
  }
  const daysHealthy = active.length === 0 ? Math.max(0, daysDiff(lastSickEnd, dateStr)) : 0;

  // C. Rolling illness baru jika tanggal berbeda dari last_roll_date atau jika sudah terlalu lama sehat
  if (sick.last_roll_date !== dateStr || daysHealthy >= 14) {
    sick.last_roll_date = dateStr;
    modified = true;

    // Jika sudah >= 14 hari tidak pernah sakit, wajib kena sakit ringan (alergi atau pilek)
    if (active.length === 0 && daysHealthy >= 14) {
      const forcedType = Math.random() < 0.6 ? 'alergi' : 'pilek';
      const cfg = ILLNESS_CONFIG[forcedType];
      const dur = randomInt(cfg.minDays, cfg.maxDays);
      active.push({
        id: `illness_${forcedType}_${dateStr}`,
        type: forcedType,
        name: cfg.name,
        started_at: dateStr,
        ends_at: addDays(dateStr, dur - 1),
        duration_days: dur,
        symptoms: cfg.symptoms,
        penalty: cfg.penalty
      });
    } else {
      // Rolling independen untuk setiap jenis sakit (memungkinkan tabrakan sakit)
      const types = ['alergi', 'pilek', 'sariawan', 'demam'];
      for (const t of types) {
        // Jangan roll jenis yang sedang aktif
        if (active.some(a => a.type === t)) continue;

        // Cek riwayat recent agar jenis yang sama tidak beruntun dalam 5 hari
        const recentSame = history.find(h => h.type === t && daysDiff(h.ends_at, dateStr) <= 5);
        if (recentSame) continue;

        const cfg = ILLNESS_CONFIG[t];
        // Peluang kemunculan per hari
        // alergi: ~10%, pilek: ~7%, sariawan: ~5%, demam: ~2%
        const rollRate = cfg.weight / 400; // max ~0.1
        if (Math.random() < rollRate) {
          const dur = randomInt(cfg.minDays, cfg.maxDays);
          active.push({
            id: `illness_${t}_${dateStr}`,
            type: t,
            name: cfg.name,
            started_at: dateStr,
            ends_at: addDays(dateStr, dur - 1),
            duration_days: dur,
            symptoms: cfg.symptoms,
            penalty: cfg.penalty
          });
        }
      }
    }
  }

  sick.active_illnesses = active;
  sick.history = history;
  healthData.sick_system = sick;

  if (modified && persist) {
    saveHealthState(healthData);
  }

  // Hitung penalti total sakit (akumulasi jika tabrakan)
  let totalSickPenalty = 0;
  const illnessNames = [];
  const symptomsList = [];
  const complaints = [];

  active.forEach(item => {
    totalSickPenalty += item.penalty || 10;
    illnessNames.push(item.name);
    symptomsList.push(item.symptoms);
    const cfg = ILLNESS_CONFIG[item.type];
    if (cfg && cfg.complaints) {
      complaints.push(cfg.complaints[Math.floor(Math.random() * cfg.complaints.length)]);
    }
  });

  totalSickPenalty = Math.min(45, totalSickPenalty);

  return {
    hasIllness: active.length > 0,
    activeCount: active.length,
    activeIllnesses: active,
    penalty: totalSickPenalty,
    summary: active.length > 0 ? illnessNames.join(' + ') : 'Sehat Prima',
    symptoms: symptomsList.join('; '),
    complaints
  };
}

/**
 * 3. Evaluasi Siklus Menstruasi (Menstrual Cycle)
 */
function evaluateMenstrualCycle(dateStr, healthData, persist = true) {
  let cycle = healthData.menstrual_cycle;
  if (!cycle) {
    cycle = getDefaultHealthState(dateStr).menstrual_cycle;
    healthData.menstrual_cycle = cycle;
  }

  let modified = false;
  let lastStart = cycle.last_period_start || addDays(dateStr, -28);
  let expectedStart = cycle.next_expected_start;
  let duration = cycle.period_duration_days || 5;

  // Jika expectedStart belum ada, hitung dari lastStart + cycle_length
  if (!expectedStart) {
    expectedStart = addDays(lastStart, cycle.cycle_length_days || 28);
    cycle.next_expected_start = expectedStart;
    modified = true;
  }

  const periodEnd = addDays(expectedStart, duration - 1);

  // Jika siklus sudah selesai terlewati (dateStr > periodEnd), arsipkan dan roll siklus berikutnya
  if (dateStr > periodEnd) {
    if (!Array.isArray(cycle.history)) cycle.history = [];
    cycle.history.unshift({
      start_date: expectedStart,
      end_date: periodEnd,
      duration_days: duration,
      cycle_length: cycle.cycle_length_days || 28
    });
    if (cycle.history.length > 12) cycle.history = cycle.history.slice(0, 12);

    // Roll siklus baru (variasi ±2 hari)
    const variance = randomInt(-2, 2);
    const nextCycleDays = 28 + variance;
    const nextPeriodDur = randomInt(MENSTRUATION_CONFIG.minPeriod, MENSTRUATION_CONFIG.maxPeriod);

    cycle.last_period_start = expectedStart;
    cycle.last_period_end = periodEnd;
    cycle.cycle_length_days = nextCycleDays;
    cycle.period_duration_days = nextPeriodDur;
    cycle.variance_days = variance;
    cycle.next_expected_start = addDays(expectedStart, nextCycleDays);

    expectedStart = cycle.next_expected_start;
    duration = nextPeriodDur;
    modified = true;
  }

  if (modified && persist) {
    saveHealthState(healthData);
  }

  // Tentukan fase pada dateStr saat ini
  const diffToExpected = daysDiff(dateStr, expectedStart); // positif jika dateStr < expectedStart
  const pmsStart = addDays(expectedStart, -2);

  let phase = 'normal';
  let penalty = 0;
  let phaseName = 'Normal / Non-Haid';
  let description = 'Kondisi hormonal stabil, tidak ada keluhan fisik menstruasi.';
  let complaints = [];

  if (dateStr >= expectedStart && dateStr <= addDays(expectedStart, duration - 1)) {
    // Sedang Haid
    const dayOfPeriod = daysDiff(expectedStart, dateStr) + 1;
    if (dayOfPeriod <= 2) {
      phase = 'haid_heavy';
      penalty = MENSTRUATION_CONFIG.phases.haid_heavy.penalty;
      phaseName = `Haid Hari ke-${dayOfPeriod} (Kram Berat)`;
      description = MENSTRUATION_CONFIG.phases.haid_heavy.description;
      complaints = MENSTRUATION_CONFIG.phases.haid_heavy.complaints;
    } else {
      phase = 'haid_light';
      penalty = MENSTRUATION_CONFIG.phases.haid_light.penalty;
      phaseName = `Haid Hari ke-${dayOfPeriod} (Lanjutan)`;
      description = MENSTRUATION_CONFIG.phases.haid_light.description;
      complaints = MENSTRUATION_CONFIG.phases.haid_light.complaints;
    }
  } else if (dateStr >= pmsStart && dateStr < expectedStart) {
    // Fase PMS
    phase = 'pms';
    penalty = MENSTRUATION_CONFIG.phases.pms.penalty;
    phaseName = 'Fase PMS (1-2 Hari Sebelum Haid)';
    description = MENSTRUATION_CONFIG.phases.pms.description;
    complaints = MENSTRUATION_CONFIG.phases.pms.complaints;
  }

  return {
    phase,
    phaseName,
    penalty,
    description,
    complaints,
    nextExpectedStart: expectedStart,
    periodDuration: duration,
    varianceDays: cycle.variance_days || 0
  };
}

/**
 * 4. Hitung Mood Gabungan dari 3 Agenda
 */
function calculateMood(dateStr, options = {}) {
  const healthData = options.healthData || loadHealthState(dateStr);
  const persist = options.persist !== false;

  const acad = getAcademicPressure(dateStr, options.roadmap);
  const sick = evaluateSickSystem(dateStr, healthData, persist);
  const menstruation = evaluateMenstrualCycle(dateStr, healthData, persist);

  const baseScore = 85;
  const situationalDelta = Number(healthData.situational_delta || 0);

  // Total deductions
  const totalDeductions = acad.penalty + sick.penalty + menstruation.penalty;
  const netScore = baseScore - totalDeductions + acad.bonus + situationalDelta;
  const finalMood = Math.max(5, Math.min(100, Math.round(netScore)));

  // Label mood
  let moodState = 'Biasa / Netral';
  let levelCode = 'normal';
  if (finalMood >= 85) {
    moodState = 'Sangat Bahagia / Ceria';
    levelCode = 'very_high';
  } else if (finalMood >= 65) {
    moodState = 'Senang / Baik';
    levelCode = 'high';
  } else if (finalMood >= 45) {
    moodState = 'Biasa / Netral';
    levelCode = 'normal';
  } else if (finalMood >= 28) {
    moodState = 'Sensi / Kurang Mood';
    levelCode = 'low';
  } else {
    moodState = 'Sangat Drop / Ambang Batas Bawah';
    levelCode = 'critical_drop';
  }

  // Pilih sample complaint jika mood rendah
  const availableComplaints = [...menstruation.complaints, ...sick.complaints];
  if (acad.penalty >= 15) {
    availableComplaints.push('dosen ngasih deadline mepet banget, mana badan lagi ga enak bgt... capek bgt hari ini :');
    availableComplaints.push('tugas dkv numpuk mana lagi ga mood ngapa-ngapain, pengen ngilang bentar aja :');
  }
  const sampleComplaint = availableComplaints.length > 0
    ? availableComplaints[Math.floor(Math.random() * availableComplaints.length)]
    : 'kalo punya pacar enak ya ngeluh kalo lg haid gini :';

  // Sinkronkan ke botState jika diizinkan
  if (options.syncBotState !== false) {
    try {
      const storage = require('./storage');
      storage.setMood(finalMood, moodState);
    } catch (_) {}
  }

  return {
    date: dateStr,
    mood: finalMood,
    moodState,
    levelCode,
    isLowMood: finalMood < 45,
    isCriticalDrop: finalMood < 28,
    factors: {
      academic: acad,
      sick,
      menstruation
    },
    sampleComplaint
  };
}

/**
 * 5. Format Blok Prompt AI untuk ai.js
 */
function getMoodPromptSection(dateStr, options = {}) {
  const result = calculateMood(dateStr, options);
  const { mood, moodState, isLowMood, isCriticalDrop, factors, sampleComplaint } = result;

  let behaviorGuide = '';
  if (isCriticalDrop) {
    behaviorGuide = `  * MOOD SANGAT DROP / AMBANG BATAS BAWAH (${mood}/100):
    - DILARANG KERAS MENGGUNAKAN KATA "wkwk", "haha", "hehe" ATAU TAWA APAPUN. Callista sedang sangat drop, sakit/kram perut hebat.
    - SANGAT SENSITIF & MUDAH TERSINGGUNG: Jika diledek, disindir, atau dicandai, respon dengan nada ketus, dingin, atau tersinggung ("apaan sih ga lucu", "dih garing bgt", "lagi ga mood bercanda ya").
    - TIDAK PEKA BERCANDAAN: Jangan ikut tertawa pada joke orang lain, anggap melelahkan atau balas datar ("oh", "hm", "terserah").
    - SESEKALI SAMBAT / CURHAT ALAMI: Callista boleh sesekali membuka celetukan curhat singkat tentang kondisi tubuhnya atau rasa magernya (contoh: "${sampleComplaint}"). PENTING: HANYA SESEKALI jika topiknya pas atau ditanya kabar; JANGAN mengeluh di setiap pesan seperti spam bot!`;
  } else if (isLowMood) {
    behaviorGuide = `  * MOOD RENDAH / SENSI (${mood}/100):
    - HINDARI / JANGAN GUNAKAN "wkwk". Callista sedang lelah fisik/sensi.
    - LEBIH SENSITIF & MUDAH TERSINGGUNG: Cenderung mager meladeni basa-basi, gunakan nada agak ketus, cuek, atau DRY_TEXT ("yaudah", "oh", "terserah").
    - TIDAK PEKA BERCANDAAN: Tanggapi joke orang dengan datar atau acuh tak acuh.
    - SESEKALI SAMBAT RINGAN: Boleh sesekali mengeluh capek atau kondisi fisik secara wajar jika pas momennya.`;
  } else if (mood > 75) {
    behaviorGuide = `  * MOOD TINGGI / CERIA (${mood}/100):
    - Callista sangat ceria, antusias, suka bercanda, banyak ekspresi (wkwk, 😭), manja dan akrab ke Mas Joy.`;
  } else {
    behaviorGuide = `  * MOOD NORMAL (${mood}/100):
    - Callista santai, wajar, bersahabat, sedikit mager tapi tetap asyik diajak ngobrol.`;
  }

  const acadSummary = factors.academic.summary + (factors.academic.penalty > 0 ? ` [Tekanan: -${factors.academic.penalty}]` : ' [Santai]');
  const sickSummary = factors.sick.summary + (factors.sick.penalty > 0 ? ` [Penalti: -${factors.sick.penalty}]` : ' [Sehat]');
  const mensSummary = factors.menstruation.phaseName + (factors.menstruation.penalty > 0 ? ` [Penalti: -${factors.menstruation.penalty}]` : ' [Normal]');

  return `[KONDISI MOOD & KESEHATAN FISIK REAL-TIME CALLISTA]:
- Skor Mood: ${mood}/100 (${moodState})
- Faktor Pemicu Mood Hari Ini:
  * 📚 Tekanan Akademik: ${acadSummary}
  * 🤒 Sistem Sakit Fisik: ${sickSummary}
  * 🌸 Siklus Menstruasi: ${mensSummary}
- ATURAN PERILAKU SESUAI MOOD:
${behaviorGuide}`;
}

/**
 * 6. Set Situational Mood Delta (mis. pujian Mas Joy)
 */
function setSituationalDelta(delta) {
  const data = loadHealthState();
  data.situational_delta = Math.max(-30, Math.min(30, Number(delta || 0)));
  saveHealthState(data);
  return data.situational_delta;
}

module.exports = {
  HEALTH_FILE,
  ILLNESS_CONFIG,
  MENSTRUATION_CONFIG,
  loadHealthState,
  saveHealthState,
  getAcademicPressure,
  evaluateSickSystem,
  evaluateMenstrualCycle,
  calculateMood,
  getMoodPromptSection,
  setSituationalDelta
};
