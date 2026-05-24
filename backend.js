// backend.js — SkillHive Core Supabase Module v5.0
// Modular, reusable Supabase DB + Auth operations for all pages

// ── Supabase Configuration ────────────────────────────────────────────────
const SUPABASE_URL      = 'https://hxnkshxuvrcazlgdhhpl.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_DmkUHD7SRWUj9lr0bL21ig_-xHOya9A';

// ── Initialize Supabase client ────────────────────────────────────────────
// IMPORTANT: Call supabase.createClient() directly from the CDN global.
// Do NOT destructure from window.supabase — and do NOT overwrite window.supabase
// (that would destroy the CDN namespace and break any subsequent createClient calls).
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── Expose initialized client globally ───────────────────────────────────
// window._supabase is the canonical client for all HTML pages to consume.
window._supabase = _supabase;

// ── Expose Auth helpers globally ─────────────────────────────────────────
// Each function properly destructures { data, error } and throws on error
// so caller try/catch blocks can surface UI alerts.
window.__supabaseSignIn = async function(email, password) {
    const { data, error } = await _supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
};

window.__supabaseSignOut = async function() {
    const { error } = await _supabase.auth.signOut();
    if (error) throw error;
    return true;
};

window.__onAuthStateChanged = function(callback) {
    return _supabase.auth.onAuthStateChange((_event, session) => {
        callback(session?.user ?? null);
    });
};

window.__getSession = async function() {
    const { data, error } = await _supabase.auth.getSession();
    if (error) throw error;
    return data;
};

// ══════════════════════════════════════════════════════════════════════════
//  MODULE 1 — SEARCH  (used by search.html)
//  fetchActiveProfessionals(service, city)
//  Returns all professionals where status == 'Active', optionally filtered
//  by skill and city.
// ══════════════════════════════════════════════════════════════════════════
window.fetchActiveProfessionals = async function(service, city) {
    try {
        let query = _supabase
            .from('professionals')
            .select('*')
            .eq('status', 'Active');

        if (service) query = query.eq('skill', service);
        if (city)    query = query.eq('city', city);

        const { data, error } = await query;

        if (error) throw error;
        return data || [];

    } catch (err) {
        console.error('[SkillHive] fetchActiveProfessionals error:', err);
        throw new Error('Failed to fetch active professionals.');
    }
};

// ── Legacy alias — keeps index.html radar search working ──────────────────
window.searchProfessionals = async function(service, city) {
    return window.fetchActiveProfessionals(service, city);
};

// ══════════════════════════════════════════════════════════════════════════
//  MODULE 2 — ADMIN  (used by admin-portal.html)
//  fetchPendingProfessionals()
//  Returns all professionals where status == 'Pending'
// ══════════════════════════════════════════════════════════════════════════
window.fetchPendingProfessionals = async function() {
    try {
        const { data, error } = await _supabase
            .from('professionals')
            .select('*')
            .eq('status', 'Pending');

        if (error) throw error;
        return data || [];

    } catch (err) {
        console.error('[SkillHive] fetchPendingProfessionals error:', err);
        throw new Error('Failed to fetch pending applications.');
    }
};

// ══════════════════════════════════════════════════════════════════════════
//  MODULE 3 — ADMIN  approveProfessional(proId)
//  Updates status from 'Pending' → 'Active'
// ══════════════════════════════════════════════════════════════════════════
window.approveProfessional = async function(proId) {
    try {
        const { data, error } = await _supabase
            .from('professionals')
            .update({
                status:      'Active',
                approved_at: new Date().toISOString()
            })
            .eq('new_id', proId)
            .select()
            .single();

        if (error) throw error;

        // WhatsApp Notification Trigger
        const proData = data;
        if (proData && proData.phone) {
            // Clean phone number (strip non-numeric chars)
            let cleanPhone = proData.phone.replace(/\D/g, '');
            // Handle PK country code if necessary (assuming local numbers start with 03)
            if (cleanPhone.startsWith('03')) cleanPhone = '92' + cleanPhone.substring(1);

            const message = `🚨 SkillHive Approval Notification%0A%0AProfessional: ${proData.name || 'N/A'}%0AService: ${proData.skill || 'N/A'}%0ACity: ${proData.city || 'N/A'}%0A%0AStatus: Verified & Activated.✅%0A%0AVisit Portal: https://skillhive.vercel.app`;
            const waUrl = `https://wa.me/${cleanPhone}?text=${message}`;

            // Trigger UI Feedback
            if (typeof window.showToast === 'function') {
                window.showToast('Professional Approved! Redirecting to WhatsApp...', 'success');
            } else {
                console.log('Professional Approved! Redirecting to WhatsApp...');
            }

            // Execute non-blocking redirect in a new tab after a brief delay
            setTimeout(() => {
                window.open(waUrl, '_blank');
            }, 800);
        }

        return true;

    } catch (err) {
        console.error('[SkillHive] approveProfessional error:', err);
        throw new Error('Approval failed. Please try again.');
    }
};

// ══════════════════════════════════════════════════════════════════════════
//  MODULE 4 — ADMIN  rejectProfessional(proId)
//  Marks row as 'Rejected' (soft delete — keeps audit trail)
// ══════════════════════════════════════════════════════════════════════════
window.rejectProfessional = async function(proId) {
    try {
        const { error } = await _supabase
            .from('professionals')
            .update({
                status:      'Rejected',
                rejected_at: new Date().toISOString()
            })
            .eq('new_id', proId);

        if (error) throw error;
        return true;

    } catch (err) {
        console.error('[SkillHive] rejectProfessional error:', err);
        throw new Error('Rejection failed. Please try again.');
    }
};

// ══════════════════════════════════════════════════════════════════════════
//  MODULE 5 — ADMIN KPIs
//  fetchAdminStats() — Returns { activePros, pendingApprovals, citiesCovered }
// ══════════════════════════════════════════════════════════════════════════
window.fetchAdminStats = async function() {
    try {
        const [activeRes, pendingRes, allRes] = await Promise.all([
            _supabase.from('professionals').select('new_id', { count: 'exact', head: true }).eq('status', 'Active'),
            _supabase.from('professionals').select('new_id', { count: 'exact', head: true }).eq('status', 'Pending'),
            _supabase.from('professionals').select('city')
        ]);

        if (activeRes.error)  throw activeRes.error;
        if (pendingRes.error) throw pendingRes.error;
        if (allRes.error)     throw allRes.error;

        const cities = new Set();
        (allRes.data || []).forEach(row => {
            if (row.city) cities.add(row.city);
        });

        return {
            activePros:       activeRes.count  ?? 0,
            pendingApprovals: pendingRes.count  ?? 0,
            citiesCovered:    cities.size
        };

    } catch (err) {
        console.error('[SkillHive] fetchAdminStats error:', err);
        throw new Error('Failed to load dashboard statistics.');
    }
};

// ══════════════════════════════════════════════════════════════════════════
//  MODULE 6 — REGISTRATION  addProfessional(data)
//  Called by join-pro.html after Supabase Storage upload.
//  Inserts a new row into the professionals table.
// ══════════════════════════════════════════════════════════════════════════
window.addProfessional = async function(data) {
    try {
        const { data: inserted, error } = await _supabase
            .from('professionals')
            .insert([data])
            .select();

        if (error) throw error;
        return inserted;

    } catch (err) {
        console.error('[SkillHive] addProfessional error:', err);
        throw new Error('Failed to save professional profile.');
    }
};

// ══════════════════════════════════════════════════════════════════════════
//  MODULE 7 — REVIEWS (SaaS Upgrades)
// ══════════════════════════════════════════════════════════════════════════

window.fetchPendingReviews = async function() {
    try {
        const query = _supabase
            .from('reviews')
            // Removed professionals(name) join for debugging purposes
            .select('*')
            .or('is_approved.eq.FALSE,is_approved.eq.false');

        console.log('[SkillHive] Query URL:', query.url ? query.url.toString() : query);

        const { data, error } = await query;

        if (error) {
            console.error('[SkillHive] Detailed fetchPendingReviews error:', error);
            throw error;
        }
        
        console.log('[SkillHive] fetchPendingReviews returning data:', data);
        return data || [];
    } catch (err) {
        console.error('[SkillHive] fetchPendingReviews error:', err);
        throw new Error('Failed to load pending reviews.');
    }
};

window.fetchApprovedReviews = async function(proId) {
    try {
        const { data, error } = await _supabase
            .from('reviews')
            .select('*')
            .eq('pro_id', proId)
            .eq('is_approved', 'TRUE');

        if (error) throw error;
        return data || [];
    } catch (err) {
        console.error('[SkillHive] fetchApprovedReviews error:', err);
        return []; // Return empty array on error so UI doesn't break
    }
};

window.approveReview = async function(reviewId) {
    try {
        const payload = { is_approved: 'TRUE' };
        console.log(`[SkillHive] approveReview -> Row ID: ${reviewId}`);
        console.log(`[SkillHive] approveReview -> Payload:`, payload);

        const { data, error } = await _supabase
            .from('reviews')
            .update(payload)
            .eq('id', reviewId)
            .select();

        if (error) {
            console.error('[SkillHive] UPDATE error object:', error);
            throw error;
        }

        if (!data || data.length === 0) {
            console.warn('[SkillHive] Update returned 0 rows! This likely means an RLS policy blocked the UPDATE operation for this user, or the ID does not exist.');
        } else {
            console.log('[SkillHive] Update successful:', data);
        }

        return true;
    } catch (err) {
        console.error('[SkillHive] approveReview error:', err);
        throw new Error('Failed to approve review.');
    }
};

window.rejectReview = async function(reviewId) {
    try {
        const { error } = await _supabase
            .from('reviews')
            .delete()
            .eq('id', reviewId);

        if (error) throw error;
        return true;
    } catch (err) {
        console.error('[SkillHive] rejectReview error:', err);
        throw new Error('Failed to reject review.');
    }
};

window.submitReviewToDatabase = async function(payload) {
    try {
        // Enforce security check: new reviews must be unapproved (string 'FALSE')
        payload.is_approved = 'FALSE';
        
        console.log('[SkillHive] submitReviewToDatabase payload:', payload);

        // We remove .select() because if RLS only allows INSERT for anon, .select() will fail with 401/403
        const { data, error } = await _supabase
            .from('reviews')
            .insert([payload]);

        if (error) {
            console.error('[SkillHive] Detailed insert error:', error);
            throw error;
        }
        return true;
    } catch (err) {
        console.error('[SkillHive] submitReviewToDatabase error:', err);
        throw new Error('Failed to submit review. Please try again.');
    }
};

// ── Signal that backend is ready ──────────────────────────────────────────
window.__skillhiveBackendReady = true;
console.log('[SkillHive] Supabase backend module v5.0 loaded. Client ready:', !!_supabase);