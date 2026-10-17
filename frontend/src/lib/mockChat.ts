// Dev-only mocked chat stream (enable with ?mockChat=1). The real /api/chat stays the default.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function mockChatStream(question: string, onEvent: (ev: string, data: unknown) => void) {
  await sleep(200)
  onEvent('tool_call', { name: 'team_profile', args: { team: 'Spain' }, call: 1 })
  await sleep(500)
  onEvent('tool_result', { name: 'team_profile', refs: ['player:6655', 'player:6765'], summary: 'Spain: top S_p Fabián Ruiz 1.28, Rodri 0.89; 7 matches', is_error: false })
  await sleep(300)
  onEvent('tool_call', { name: 'simulate', args: { team: 'Spain', interventions: [{ type: 'suppress', target_player: 6655, presser: 3943 }] }, call: 2 })
  await sleep(700)
  onEvent('tool_result', { name: 'simulate', refs: ['player:6655', 'match:3943043', 'edge:6655->68574'], summary: 'ΔC -7.6% ±4.1 over 7 matches (modeled); empirical -3.1% from 95 absent minutes', is_error: false })
  await sleep(200)
  const text = `Spain's circulation runs through Fabián Ruiz: he carries the highest composite score (S_p 1.28) and his lane to Nico Williams is the most progressive in the squad. Marking him with Declan Rice is modeled to cut circulation by 7.6% on average over 7 matches; the one match he actually missed shows a 3.1% drop, so treat the modeled figure as an upper bound for "${question.slice(0, 40)}".\n\n\`\`\`json\n{"claims":[{"text":"Fabián Ruiz is Spain's highest-S_p player","refs":["player:6655"],"basis":"empirical","value":"S_p 1.28"},{"text":"Rice marking Ruiz lowers circulation 7.6% (mean over 7 matches)","refs":["player:6655","player:3943","match:3943043"],"basis":"modeled","value":"-7.6%"},{"text":"In Ruiz's 95 absent minutes circulation fell 3.1%","refs":["player:6655","match:3930179"],"basis":"empirical","value":"-3.1%"}]}\n\`\`\``
  for (const word of text.split(/(?<= )/)) {
    onEvent('text', { delta: word })
    await sleep(18)
  }
  onEvent('claims', {
    claims: [
      { text: "Fabián Ruiz is Spain's highest-S_p player", refs: ['player:6655'], basis: 'empirical', value: 'S_p 1.28' },
      { text: 'Rice marking Ruiz lowers circulation 7.6% (mean over 7 matches)', refs: ['player:6655', 'player:3943', 'match:3943043', 'edge:6655->68574'], basis: 'modeled', value: '-7.6%' },
      { text: "In Ruiz's 95 absent minutes circulation fell 3.1%", refs: ['player:6655', 'match:3930179'], basis: 'empirical', value: '-3.1%' },
    ],
    plan_id: null, parse_error: null,
  })
  onEvent('done', { calls: 3, budget: 15 })
}
