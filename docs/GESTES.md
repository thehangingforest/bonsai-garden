# Gestes coopératifs — contrats figés

Deux gestes, à greffer sur le jardin :

1. **Ouvrir la conversation d'un agent** (un bonsaï) : reprendre sa dernière
   conversation persistée sur la route de son profil ; à défaut, ouvrir un brouillon.
2. **Interrompre un agent occupé** : trouver sa session vivante non-idle et
   envoyer `session.interrupt` sur l'id runtime.

Statut : implémentés (TDD rouge→vert, 19/19 au 2026-11-06). Source de vérité du code :
`src/plugin.mjs` ; specs exécutables : `tests/plugin.test.mjs`.

## Portes SDK utilisées (production = apps/desktop/src/sdk)

| Porte | Signature (verbatim) | Fichier |
|---|---|---|
| routes | `host.profileRoutes()` → `PluginProfileRoute[]` `{connectionId, profile, targetProfile, mode}` | `src/sdk/index.ts:1347` |
| requête par profil | `requestProfile(route, method, params, timeoutMs?, {spawnPriority})` | `src/sdk/index.ts:1383` |
| sessions persistées | `listPersistedSessions(route\|null, {profile, limit})` → `{sessions: SessionInfo[], total, limit, offset}` | `src/sdk/index.ts:1431` |
| ouvrir une session | `openSession(storedId, {route, profile, intent, awaitHydration, forceResume})` | `src/sdk/index.ts:815` (options :273–313) |
| brouillon | `newChat(profile\|route, options)` | `src/sdk/index.ts:1242` |

Méthodes gateway (contrat généré `apps/shared/src/gateway-contract.generated.ts`) :

- `session.active_list` — params `{profile?: string|null, current_session_id?: string|null}` ;
  résultat `{sessions: SessionActiveItem[]}`.
  `SessionActiveItem = {current, id, last_active, message_count, model, preview,
  session_key, source?, started_at, status, title}` — **pas de champ `profile`** :
  le filtrage par agent est fait par le serveur via le paramètre `profile`.
- `session.interrupt` — params `{session_id: <id runtime vivant>}`. C'est exactement
  ce que le desktop envoie lui-même (`use-session-actions/index.ts:3103`), et ce que
  la recette `hermes-bots/group-rounds.ts` utilise en best-effort. Handler :
  `tui_gateway/methods_session_interrupt.py` (`sid = params.get('session_id')`) →
  `{status:'interrupted'}`, ou `{status:'not_interrupted', interrupted:false}` en
  conflit d'isolation.

`LiveSessionStatus = 'idle' | 'starting' | 'waiting' | 'working' | 'streaming' | 'resuming'`.

## Décisions

- **Résolution de route par agent** : `resolveAgentRoute(routes, agent)` matche
  `route.profile === agent` OU `route.targetProfile === agent` ; première trouvée ;
  entrée nulle/non-tableau → `null`. Aucun geste sans route.
- **Profil envoyé dans les params** : `route.targetProfile || route.profile`
  (recette `scopedBotParams` de `hermes-bots/routing.ts:151`). `profile` logique
  reste le nom d'agent côté UI ; le backend reçoit la cible.
- **Ouvrir** : `listPersistedSessions(route, {profile, limit: 5})`, puis
  `pickStoredSession` : ignore `is_internal_child`, prend le `last_active` (nombre)
  le plus haut ; sans dates, premier de la liste (l'API liste du plus récent au plus
  ancien). `openSession(storedId, {route, profile, intent:'in-place',
  awaitHydration:true, forceResume:true})` — le clic est une navigation explicite.
- **Brouillon** : uniquement si la liste a répondu et est vide. Si
  `listPersistedSessions` existe et **échoue**, on ne ouvre pas de brouillon par
  dessus une conversation existante : `{ok:false, reason:'failed'}`.
- **Interrompre** : occupé = `starting|waiting|working|streaming|resuming`
  (`idle` et statuts inconnus ignorés — conservateur : pas de bouton quand on ne
  sait pas). Cible = item au `last_active` le plus haut parmi les occupés.
  `{interrupted:false}` en retour → `{ok:false, reason:'not-interrupted'}`.
- **Best-effort** : aucune exception ne sort d'un geste ; tout est retourné.
- Le geste n'agit jamais sur la session d'un autre agent : la route est résolue
  d'abord, et le serveur scope `active_list` par `profile`.

## Formes des retours (API du plugin)

```js
resolveAgentRoute(routes, agent)        → route | null
pickBusySession(items)                  → SessionActiveItem | null
pickStoredSession(sessions)             → SessionInfo | null
openAgentConversation(agent, api=host)  → {ok:true, kind:'session', storedId}
                                        | {ok:true, kind:'draft'}
                                        | {ok:false, reason:'no-route'|'unsupported'|'failed'}
interruptAgent(agent, api=host)         → {ok:true, sessionId}
                                        | {ok:false, reason:'no-route'|'unsupported'|'not-busy'|'not-interrupted'|'failed'}
```

`api` est injectable (même motif que `loadRoutines(api = host)`) : les tests
passent un faux host, aucun besoin de stub global pour les tests unitaires.

## Contrat d'interface

- Bouton `[data-gesture="open"][data-agent="<agent>"]`, libellé contenant
  « conversation ».
- Bouton `[data-gesture="interrupt"][data-agent="<agent>"]` présent **seulement**
  si l'agent est occupé (`session.active_list`).
- Sans routes (`profileRoutes` absent) : aucun bouton de geste, aucun nouvel appel.
- v1 : les gestes vivent sur les rangées d'agents déjà rendues par les routines
  (un agent sans routine n'a pas encore de rangée).

## Vérifier

```
node --test --test-reporter=tap /home/papa/Bureau/bonsai-garden/tests/plugin.test.mjs
```

Traces par cycle dans `/home/papa/Bureau/SESSIONS/2026-11-06/`.

## Pièges

- Un item `active_list.id` est un **id runtime vivant** ; un `SessionInfo.id` est
  un **id stocké**. `session.interrupt` veut le premier, `session.delete`/titres
  veulent le second. Ne pas les croiser.
- `listPersistedSessions` peut renvoyer des enfants internes (`is_internal_child`)
  et des lignes cachées : ne pas les rouvrir comme « la conversation de l'agent ».
- Le test d'intégration des routines assertait `calls.length === 2` sur
  `requestProfile` : les gestes ajoutent des `session.active_list`, l'assertion a
  été relaxée sur les seuls appels `cron.manage`.
- Contrainte README : imports limités à `@hermes/plugin-sdk`, `react`,
  `react/jsx-runtime` ; pas de backend, pas de dépendance npm, rien d'installé par
  les tests.
