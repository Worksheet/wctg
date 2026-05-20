const NTFY_BASE = process.env.NTFY_BASE || 'https://ntfy.sh';

async function notify(player, subject, body, confirmUrl, rejectUrl) {
  if (player.ntfy_topic) {
    try {
      const actions = confirmUrl
        ? `view, Confirm, ${confirmUrl}; view, Reject, ${rejectUrl}`
        : undefined;
      const headers = { Title: subject, Priority: 'default' };
      if (actions) headers.Actions = actions;
      await fetch(`${NTFY_BASE}/${player.ntfy_topic}`, {
        method: 'POST',
        headers,
        body,
      });
    } catch (e) {
      console.error('ntfy error:', e.message);
    }
  }
  return buildMailto(player.email, subject, body);
}

function buildMailto(to, subject, body) {
  const s = encodeURIComponent(subject);
  const b = encodeURIComponent(body);
  return `mailto:${encodeURIComponent(to)}?subject=${s}&body=${b}`;
}

module.exports = { notify, buildMailto };
