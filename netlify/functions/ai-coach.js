const { json, parseJsonBody } = require('./_response');

function roundToIncrement(value, increment) {
  return Math.round(value / increment) * increment;
}

function getDeltaForExercise(name = '', units = 'lbs') {
  const normalized = String(name).toLowerCase();
  if (units === 'kg') {
    if (normalized.includes('squat') || normalized.includes('deadlift') || normalized.includes('rdl') || normalized.includes('lunge') || normalized.includes('thruster')) {
      return 2.5;
    }
    return 1;
  }

  if (normalized.includes('squat') || normalized.includes('deadlift') || normalized.includes('rdl') || normalized.includes('lunge') || normalized.includes('thruster')) {
    return 5;
  }
  return 2.5;
}

function deterministicCoach(snapshot) {
  const recentFeedback = Array.isArray(snapshot?.recentFeedback) ? snapshot.recentFeedback : [];
  const latestFeedback = recentFeedback[0]?.feedback || null;
  const daysSince = Number(snapshot?.daysSinceLastWorkout || 0);
  const units = snapshot?.units === 'kg' ? 'kg' : 'lbs';
  const loadableExercises = Array.isArray(snapshot?.currentWorkout?.loadableExercises)
    ? snapshot.currentWorkout.loadableExercises
    : [];

  let headline = 'Build a clean baseline today';
  let summary = 'Use your last logged loads as a reference and prioritize crisp reps.';
  let sessionFocus = 'Stay consistent and leave one clean rep in reserve on every set.';
  let recommendationType = 'hold';
  let recoveryNote = daysSince >= 3
    ? `You have had ${daysSince} day${daysSince === 1 ? '' : 's'} away from training. Start smooth before you push load.`
    : 'Normal session cadence. Move with intent and keep rest tight.';

  if (daysSince >= 5) {
    headline = 'Ease back in and rebuild rhythm';
    summary = 'You have had a longer break. Treat this as a re-entry session and own the technique first.';
    sessionFocus = 'Repeat your last good weight or go slightly lighter if the warm-up feels off.';
    recommendationType = 'reentry';
  } else if (latestFeedback === 'easy') {
    headline = 'You are ready to nudge load up';
    summary = 'Recent sessions looked comfortable. Add a small step on your main loaded movements if form stays tight.';
    sessionFocus = 'Take the smallest useful jump and keep your rep quality the same.';
    recommendationType = 'increase';
  } else if (latestFeedback === 'hard') {
    headline = 'Hold steady and clean up execution';
    summary = 'Your last session ran hard. Keep the load steady or trim it back slightly to restore form quality.';
    sessionFocus = 'Move slower on the lowering phase and own the first rep.';
    recommendationType = 'reduce';
  } else if (latestFeedback === 'perfect') {
    headline = 'Repeat the quality, then progress';
    summary = 'You are in a good groove. Keep the same loads unless the first set feels clearly easier than last time.';
    sessionFocus = 'Do not chase weight unless the movement still feels controlled and repeatable.';
    recommendationType = 'hold';
  }

  const suggestions = loadableExercises.slice(0, 3).map(exercise => {
    const lastWeight = Number(exercise.lastWeight);
    const hasLastWeight = Number.isFinite(lastWeight) && lastWeight > 0;
    const delta = getDeltaForExercise(exercise.name, units);
    let action = recommendationType === 'increase' ? 'increase' : 'hold';
    let targetWeight = hasLastWeight ? lastWeight : null;
    let reason = 'Use your last logged load as the reference point today.';

    if (!hasLastWeight) {
      action = 'establish';
      targetWeight = null;
      reason = 'No prior load logged. Start conservative and log the first clean working weight.';
    } else if (daysSince >= 7) {
      action = 'reduce';
      targetWeight = roundToIncrement(Math.max(delta, lastWeight - delta), delta);
      reason = 'Long layoff. Reduce one step and rebuild momentum with clean reps.';
    } else if (daysSince >= 5) {
      action = 'hold';
      targetWeight = roundToIncrement(lastWeight, delta);
      reason = 'Re-entry day. Repeat the last solid load before pushing higher.';
    } else if (latestFeedback === 'easy') {
      action = 'increase';
      targetWeight = roundToIncrement(lastWeight + delta, delta);
      reason = `Last session looked comfortable. Add ${delta} ${units} if your warm-up confirms it.`;
    } else if (latestFeedback === 'hard') {
      action = 'reduce';
      targetWeight = roundToIncrement(Math.max(delta, lastWeight - delta), delta);
      reason = `Last session ran hard. Pull back ${delta} ${units} and rebuild clean reps.`;
    } else if (latestFeedback === 'perfect') {
      action = 'hold';
      targetWeight = roundToIncrement(lastWeight, delta);
      reason = 'Keep the same load and prove the reps are repeatable before moving up.';
    }

    return {
      exerciseName: exercise.name,
      action,
      targetWeight,
      units,
      reason,
    };
  });

  return {
    headline,
    summary,
    sessionFocus,
    recoveryNote,
    recommendationType,
    confidence: daysSince >= 5 ? 'medium' : 'high',
    suggestions,
    source: 'rule_based',
  };
}

function extractStructuredPayload(responseData) {
  if (responseData?.output_parsed && typeof responseData.output_parsed === 'object') {
    return responseData.output_parsed;
  }

  if (responseData?.output_text) {
    return JSON.parse(responseData.output_text);
  }

  const content = responseData?.output?.[0]?.content || [];
  for (const part of content) {
    if (part?.text) {
      return JSON.parse(part.text);
    }
  }

  throw new Error('No structured payload returned');
}

async function createOpenAICoach(snapshot, fallback) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return fallback;

  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['headline', 'summary', 'sessionFocus', 'recoveryNote', 'recommendationType', 'confidence', 'suggestions'],
    properties: {
      headline: { type: 'string' },
      summary: { type: 'string' },
      sessionFocus: { type: 'string' },
      recoveryNote: { type: 'string' },
      recommendationType: { type: 'string', enum: ['increase', 'hold', 'reduce', 'reentry'] },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      suggestions: {
        type: 'array',
        maxItems: 3,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['exerciseName', 'action', 'reason'],
          properties: {
            exerciseName: { type: 'string' },
            action: { type: 'string', enum: ['increase', 'hold', 'reduce', 'establish'] },
            targetWeight: { type: ['number', 'null'] },
            units: { type: 'string' },
            reason: { type: 'string' },
          },
        },
      },
    },
  };

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      input: [
        {
          role: 'system',
          content: [
            {
              type: 'input_text',
              text:
                'You are a concise fitness progression coach for a home dumbbell strength app for busy parents. Return brief training guidance only. Do not provide medical diagnosis, injury treatment, or non-fitness content. Use the supplied data and stay conservative. If confidence is low, prefer hold over aggressive increases.',
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: JSON.stringify({
                snapshot,
                fallback,
                instructions: 'Refine the fallback into crisp training guidance. Keep each field short and operational.',
              }),
            },
          ],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'fitness_progression_coach',
          strict: true,
          schema,
        },
      },
    }),
  });

  if (!response.ok) {
    const payload = await response.text();
    const error = new Error(`OpenAI request failed (${response.status})`);
    error.detail = payload;
    throw error;
  }

  const data = await response.json();
  const structured = extractStructuredPayload(data);
  return {
    ...structured,
    source: 'openai',
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  let snapshot;
  try {
    ({ snapshot } = parseJsonBody(event));
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }

  if (!snapshot || typeof snapshot !== 'object') {
    return json(400, { error: 'Missing snapshot' });
  }

  const fallback = deterministicCoach(snapshot);

  try {
    const coach = await createOpenAICoach(snapshot, fallback);
    return json(200, { coach });
  } catch (error) {
    return json(200, {
      coach: {
        ...fallback,
        source: 'rule_based',
      },
      degraded: true,
    });
  }
};
