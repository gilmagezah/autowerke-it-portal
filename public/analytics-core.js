// Earnings analytics core. Runs in the browser (analytics page) AND in Node
// (unit tests), so it has no dependencies and no DOM access.
//
// Money rules:
//   - All stored amounts are EXCLUDING VAT. VAT is added where vatApplicable.
//   - Support VAT is deliberately ignored here: support always counts without
//     VAT, in both the excl. and incl. views (the client's PDF still shows it).
//   - IT Project value  = contract_value (entered by admin when sending pricing)
//   - IT Support value  = hours x hourly_rate (logged hours once work starts;
//                         estimated hours before that)
//   - Domains value     = the SERVICE FEE only. The domain cost itself passes
//                         straight through to the registrar, so it isn't income.
//   - Consultancy       = not counted yet (no pricing on it)
//
// Every request lands in one stage:
//   earned    - project closed / support ticket completed (money in)
//   committed - client agreed: project proceeding/signed/in delivery,
//               support in progress or awaiting the client's sign-off
//   quoted    - price sent, waiting on the client's decision
//   lost      - client declined after receiving a price
//   early     - no price yet (ignored by money metrics)

(function (root) {
  const DAY = 24 * 60 * 60 * 1000;

  function minutesBetween(start, end) {
    const toMin = (t) => {
      const [h, m] = String(t || '').split(':').map(Number);
      return h * 60 + m;
    };
    const diff = toMin(end) - toMin(start);
    return Number.isFinite(diff) && diff > 0 ? diff : 0;
  }

  function loggedHours(workLog) {
    return (workLog || []).reduce((sum, e) => sum + minutesBetween(e.start, e.end), 0) / 60;
  }

  const round2 = (n) => Math.round(n * 100) / 100;

  function projectStage(status, hasPrice) {
    if (status === 'closed') return 'earned';
    if (['proceeding', 'signed', 'delivered'].includes(status)) return 'committed';
    if (status === 'pricing_sent') return 'quoted';
    if (status === 'declined' && hasPrice) return 'lost';
    return 'early';
  }

  function domainStage(status, hasQuote) {
    if (status === 'domain_registered') return 'earned';
    if (status === 'domain_accepted') return 'committed';
    if (status === 'domain_quoted') return 'quoted';
    if (status === 'declined' && hasQuote) return 'lost';
    return 'early';
  }

  function supportStage(status, hasPrice) {
    if (status === 'completed') return 'earned'; // client signed off
    if (status === 'in_progress' || status === 'awaiting_signoff') return 'committed';
    if (status === 'estimate_sent') return 'quoted';
    if (status === 'declined' && hasPrice) return 'lost';
    return 'early';
  }

  // Turn raw project rows into uniform "deal" records.
  function normalize(rows, vatRate) {
    return (rows || []).map((r) => {
      const isSupport = r.request_type === 'IT Support';
      const isDomain = r.request_type === 'Domains';
      const isConsult = r.request_type === 'Consultancy';
      let vatApplicable = r.vat_applicable !== false;
      let rowVatRate = vatRate;
      let amountExcl = 0;
      let missingValue = false;
      let hours = 0;
      let stage;

      if (isConsult) {
        // Free consultations never count; paid ones count their fee (excl. VAT)
        const fee = Number(r.consult_fee) || 0;
        if (fee > 0) {
          amountExcl = fee;
          if (['consult_answered', 'consult_closed'].includes(r.status)) stage = 'earned';
          else if (['consult_meeting_invited', 'consult_meeting_requested', 'consult_meeting_confirmed'].includes(r.status)) stage = 'committed';
          else stage = 'early';
        } else stage = 'early';
      } else if (isDomain) {
        const q = r.domain_quote;
        stage = domainStage(r.status, Boolean(q));
        if (q && stage !== 'early') {
          amountExcl = Number(q.service_fee) || 0;
          vatApplicable = q.vat_applicable !== false;
          if (Number.isFinite(Number(q.vat_rate))) rowVatRate = Number(q.vat_rate); // the rate the client was actually quoted
        }
      } else if (isSupport) {
        const rate = Number(r.hourly_rate) || 0;
        const est = Number(r.estimated_hours) || 0;
        hours = loggedHours(r.work_log);
        stage = supportStage(r.status, rate > 0 && est > 0);
        if (stage === 'earned' || r.status === 'awaiting_signoff') {
          // Hours are locked in once the sign-off is sent: bill logged hours, or the estimate if none
          amountExcl = (hours > 0 ? hours : est) * rate;
        } else if (stage === 'committed') amountExcl = Math.max(hours, est) * rate;
        else if (stage === 'quoted' || stage === 'lost') amountExcl = est * rate;
      } else {
        const hasValue = r.contract_value !== null && r.contract_value !== undefined && r.contract_value !== '';
        stage = projectStage(r.status, Boolean(r.pricing_estimate) || hasValue);
        if (stage !== 'early') {
          if (hasValue) amountExcl = Number(r.contract_value) || 0;
          else missingValue = true;
        }
      }

      amountExcl = round2(amountExcl);
      const vat = vatApplicable && !isSupport ? round2((amountExcl * rowVatRate) / 100) : 0;

      const earnedAt = (isSupport || isDomain) ? (r.completed_at || r.updated_at) : isConsult ? r.updated_at : (r.closed_at || r.updated_at);
      return {
        id: r.id,
        ref: r.project_id,
        title: r.project_title || '',
        company: (r.company_name || 'Unknown').trim(),
        type: isSupport ? 'support' : isDomain ? 'domain' : isConsult ? 'consultancy' : 'project',
        status: r.status,
        stage,
        amountExcl,
        vat,
        amountIncl: round2(amountExcl + vat),
        vatApplicable,
        missingValue,
        hours: round2(hours),
        createdAt: r.created_at,
        earnedAt: stage === 'earned' ? earnedAt : null,
      };
    });
  }

  // ---------- Date ranges ----------

  function rangeFor(preset, now = new Date()) {
    const y = now.getFullYear();
    const m = now.getMonth();
    switch (preset) {
      case 'month': return { from: new Date(y, m, 1), to: now };
      case '3m': return { from: new Date(y, m - 2, 1), to: now };
      case '12m': return { from: new Date(y, m - 11, 1), to: now };
      case 'ytd': return { from: new Date(y, 0, 1), to: now };
      default: return { from: null, to: now }; // 'all'
    }
  }

  function monthKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  // Every month from `from` to `to` inclusive (capped at 36 buckets)
  function monthBuckets(from, to) {
    const out = [];
    const cur = new Date(from.getFullYear(), from.getMonth(), 1);
    while (cur <= to && out.length < 36) {
      out.push(monthKey(cur));
      cur.setMonth(cur.getMonth() + 1);
    }
    return out;
  }

  // ---------- Aggregation ----------

  // filters: { type: 'all'|'project'|'support', range: 'month'|'3m'|'12m'|'ytd'|'all', company: string|null }
  // vatMode: 'excl' | 'incl'
  function aggregate(deals, { type = 'all', range = '12m', company = null } = {}, vatMode = 'excl', now = new Date()) {
    const amt = (d) => (vatMode === 'incl' ? d.amountIncl : d.amountExcl);
    const inScope = deals.filter((d) =>
      (type === 'all' || d.type === type) &&
      (!company || d.company.toLowerCase() === company.toLowerCase())
    );

    const { from, to } = rangeFor(range, now);
    const earned = inScope.filter((d) => {
      if (d.stage !== 'earned' || !d.earnedAt) return false;
      const t = new Date(d.earnedAt);
      return (!from || t >= from) && t <= to;
    });

    const sum = (arr, fn) => round2(arr.reduce((s, d) => s + fn(d), 0));

    // Headline numbers
    const earnedProjects = earned.filter((d) => d.type === 'project' && !d.missingValue);
    const earnedSupport = earned.filter((d) => d.type === 'support');
    const supportHours = sum(earnedSupport, (d) => d.hours);
    const supportExcl = sum(earnedSupport, (d) => d.amountExcl);

    const totals = {
      earned: sum(earned, amt),
      earnedExcl: sum(earned, (d) => d.amountExcl),
      earnedIncl: sum(earned, (d) => d.amountIncl),
      vatCollected: sum(earned, (d) => d.vat),
      count: earned.length,
      projectCount: earned.filter((d) => d.type === 'project').length,
      supportCount: earnedSupport.length,
      domainCount: earned.filter((d) => d.type === 'domain').length,
      avgProjectValue: earnedProjects.length ? round2(sum(earnedProjects, amt) / earnedProjects.length) : 0,
      supportHours,
      effectiveHourlyRate: supportHours > 0 ? round2(supportExcl / supportHours) : 0,
    };

    // Pipeline isn't date-filtered: it's money that hasn't landed yet
    const committed = inScope.filter((d) => d.stage === 'committed');
    const quoted = inScope.filter((d) => d.stage === 'quoted');
    const pipeline = {
      committed: sum(committed, amt),
      committedCount: committed.length,
      quoted: sum(quoted, amt),
      quotedCount: quoted.length,
      total: round2(sum(committed, amt) + sum(quoted, amt)),
    };

    // Win rate: of everything that got a price and a decision, how much was won?
    const won = inScope.filter((d) => d.stage === 'earned' || d.stage === 'committed').length;
    const lost = inScope.filter((d) => d.stage === 'lost').length;
    const winRate = won + lost > 0 ? Math.round((won / (won + lost)) * 100) : null;

    // Earnings by month, split by type
    const chartFrom = from || (earned.length
      ? new Date(Math.min(...earned.map((d) => new Date(d.earnedAt).getTime())))
      : new Date(now.getFullYear(), now.getMonth(), 1));
    const months = monthBuckets(chartFrom, to);
    const byMonth = months.map((key) => {
      const inMonth = earned.filter((d) => monthKey(new Date(d.earnedAt)) === key);
      return {
        key,
        project: sum(inMonth.filter((d) => d.type === 'project'), amt),
        support: sum(inMonth.filter((d) => d.type === 'support'), amt),
        domain: sum(inMonth.filter((d) => d.type === 'domain'), amt),
        consultancy: sum(inMonth.filter((d) => d.type === 'consultancy'), amt),
      };
    });

    // Earnings by company (highest first)
    const companyMap = {};
    earned.forEach((d) => {
      const k = d.company.toLowerCase();
      if (!companyMap[k]) companyMap[k] = { company: d.company, amount: 0, count: 0 };
      companyMap[k].amount = round2(companyMap[k].amount + amt(d));
      companyMap[k].count += 1;
    });
    const byCompany = Object.values(companyMap).sort((a, b) => b.amount - a.amount);

    // Average days from request to close (projects that closed in range)
    const closeDays = earned
      .filter((d) => d.type === 'project' && d.createdAt)
      .map((d) => (new Date(d.earnedAt) - new Date(d.createdAt)) / DAY);
    const avgDaysToClose = closeDays.length ? Math.round(closeDays.reduce((a, b) => a + b, 0) / closeDays.length) : null;

    // Projects that need a value typed in (any type filter, any stage with money)
    const missingValues = deals.filter((d) => d.missingValue);

    return { totals, pipeline, winRate, won, lost, byMonth, byCompany, avgDaysToClose, missingValues, earned };
  }

  const api = { normalize, aggregate, loggedHours, rangeFor, monthBuckets };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AnalyticsCore = api;
})(typeof window !== 'undefined' ? window : this);
