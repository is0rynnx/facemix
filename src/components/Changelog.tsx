export const APP_VERSION='1.6.1';
const releases=[
 {version:APP_VERSION,date:'2026-10-29',changes:['Restart a failed or stalled detector once. Stop preparation if the retry fails.','Close the library before adding photos. Keep face selection above other dialogs.','Add release history to Help.']},
 {version:'1.6.0',commit:'2969283',date:'2026-10-29',changes:['Restore rendering after a worker failure. Keep the previous renderer address available.','Remove automatic recovery snapshots and their menu.']},
 {version:'1.6.0',commit:'52c3ae5',date:'2026-10-28',changes:['Refine visible face contours and add upper eyelid points.','Add feathering to source contribution masks. Improve automatic hair removal.']},
 {version:'1.6.0',commit:'2157ddd',date:'2026-10-28',changes:['Match Shape section text to Regions.']},
 {version:'1.6.0',commit:'1747809',date:'2026-10-28',changes:['Correct temple and cheek boundary placement.','Improve library controls and Compare layout. Make Shape sections collapsible.']},
 {version:'1.6.0',commit:'b44b5f7',date:'2026-10-28',changes:['Show the active isolate state. Fit library labels on small screens.']},
 {version:'1.6.0',commit:'f3bfbdb',date:'2026-10-28',changes:['Add touch menus for photo actions.','Add Equalize to source properties.']},
 {version:'1.6.0',commit:'1c130c3',date:'2026-10-27',changes:['Restore saved project, variant, and editor state after reload.','Improve mobile controls and photo paste.']},
 {version:'1.6.0',commit:'c464e65',date:'2026-10-27',changes:['Initial browser release with face morphing, shape controls, masks, saved variants, and PNG export.','Include the Human Phenotypes library.']}
];

export function Changelog(){return <details className="help-changelog"><summary>Changelog <span>{APP_VERSION}</span></summary><ol>{releases.map(release=><li key={release.commit??release.version}><div><strong>{release.version}{release.commit&&<> · {release.commit}</>}</strong><time dateTime={release.date}>{release.date}</time></div><ul>{release.changes.map(change=><li key={change}>{change}</li>)}</ul></li>)}</ol></details>;}
