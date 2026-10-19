# Provenance and capsules

For supported processing paths, DataLab-Web records how a result was obtained: the processing or analysis applied, its parameters, the objects it used with their exact content, and the software versions. This record is saved with the HDF5 workspace. DataLab-Web and DataLab Desktop both read it back, and both exchange it as a **capsule**.

This page follows the usual path, from processing to exchange. Nothing in it requires a server of your own, an account or a command line. The browser downloads the computation engine when DataLab-Web starts (there is no offline mode); your data and computations stay in the browser.

## 1. Process, save, close and reopen

Process signals and images as usual: supported processing is recorded at the same time. If the runtime cannot record provenance, DataLab-Web says _Provenance is not available in this session: processing works as usual._ Capture does not block the calculation: an individual capture failure is logged and counted, and the result may exist without a corresponding activity.

_File > Save to HDF5 file…_ saves the workspace with its provenance. _File > Open HDF5 files…_ replaces the current workspace by a saved one and reads its provenance back, whether it was saved by DataLab-Web or by DataLab Desktop.

## 2. See where a result comes from

Select an object and open the **Provenance** tab of the side panel:

- **Production** shows the recorded step that produced the current content: the operation, its parameters, its inputs and results with their status. **Recorded analyses** lists the analyses run on the object.
- **▸ Show recorded step**, under an input, shows how that input was itself produced, as it was at the time, even if the input object was modified since.
- **Go to object** selects the object that holds an input or a result today.
- **Details** shows the context of the step (options, X alignment, metadata read) and the software versions.
- **Records of an old workspace** shows what older versions stored in the object metadata. These records are shown as stored and are never replayed.

Consulting reads the record only. It never computes, never loads data and never changes the workspace. The view is bounded and long values are abbreviated: a truncated view does not mean that the record was removed.

## 3. Consult, check, verify: three different things

| Action                                       | What it does                                                                                            | Computes?                                    |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Consult (the **Provenance** tab)             | Reads the record                                                                                        | No                                           |
| **Check data**                               | Compares the object, the inputs and results of its production with their recorded states (fingerprints) | No                                           |
| **Verify computation**, **Verify this step** | Recomputes the step separately and compares every result with the recorded one                          | Yes, on copies; the workspace is not changed |

A verification gives one of four verdicts:

- _Exact_: equal according to the published scientific comparison criteria (not a promise of identical archive bytes).
- _Within tolerance_: values within the tolerance declared and justified for that operation (e.g. Fourier transforms, fits).
- _Different_.
- _Not verified_, with its reason, e.g. an original input missing or an operation that cannot be replayed.

With the disk storage mode, the data of an object may not be loaded. **Check data** then says _The data of the object are not loaded: they cannot be checked_: it does not load them silently.

An explicit **Verify** may load only the source and reference objects needed for that activity, then release the arrays loaded for it back to disk. Objects already resident are not reloaded. An opaque activity, including an old metadata record, is refused without loading arrays or running a calculation.

## 4. An earlier state whose data are gone

The record describes the states used by recorded computations (fingerprints and known production). It does not keep all their arrays. Deleting or replacing an input's numerical data can prevent replay: its description remains, but verification is _Not verified_, with the reason. Saving a filtered signal after deleting its source saves the description of that source, not its old arrays; reopening does not reconstruct them.

**ROI-only changes are an exception:** if the input's numerical data are unchanged, its recorded ROI can be restored on a copy, for example after a detection added ROI. This does not restore missing numerical values. A missing or altered output still cannot serve as a comparison reference: restoring an input's ROI does not repair an output.

Keep both the necessary inputs and the recorded results before saving. A later analysis can also replace a result under the same metadata key: its earlier artifact remains described as `replaced`, without necessarily retaining its old value.

## 5. Exchange a capsule with the other edition

_File > Workspace capsule…_ opens the capsule dialog. DataLab Desktop offers the same dialog, and a capsule exported by either edition opens in the other one.

- **Export**: name, description, attachments (light files such as a protocol, at most 8 of 16 MiB each, never opened), and **Revision of…** when the workspace was opened from a capsule (also after it was saved as a workspace file and opened again). **Reference the workspace instead of including it** stores only the address, size and SHA-256 of the workspace. **Export capsule…** downloads the capsule.
- **Inspect**: **Choose a capsule…** checks a capsule without opening it. It shows the summary, the **Attachments** (saved only with **Save…**), the **Integrity** computed from the files (nothing is recomputed), and the **Supplied documents** (verification reports and reviews, added with **Add a verification report…** and **Add a review…**). **Write a review** creates a separate review file. **Open as workspace** replaces the current workspace by the workspace of the capsule.
- **Local replay** lists the recorded activities of the open workspace. **Replay** recomputes one and gives its verdict; **Save report…** saves the verification report.
- **Revisions** lists the capsules exported, inspected or retrieved in this browser, and compares two of them (**Compare**).
- **Registry** (optional): **List revisions**, **Retrieve** and **Publish to the registry**, with everything returned checked.

The integrity of a capsule, the supplied documents and the local replay are always shown apart. A verdict written in a supplied report is what its author claims; a local replay is what DataLab-Web computed.

> **Before sharing:** review the arrays, metadata, titles, trials, timestamps and attachments. Nothing is anonymized or redacted automatically. Deleting an object does not erase its recorded traces.

An export contains the workspace, its record and chosen attachments, not every upstream resource or the automatically selected minimal analysis for a result. Trials and intermediate objects may travel with it. Copying a result alone into another workspace does not make it a complete verifiable analysis: deliberately keep or rebuild its useful inputs and check what remains verifiable, rather than editing the record by hand. Physical acquisition, equipment and conversions before native object creation are not automatically replayed; CSV/TIFF sources and acquisition documents are not attached unless you choose them.

For a referenced capsule, supply the HDF5 separately. Its address is not downloaded automatically; its bytes must match the declared size and SHA-256. The registry cannot deliver that workspace for you. Attachments are chosen by the author and checked only as bytes; a child does not copy its parent's attachments, so select them again when needed.

In the browser, a capsule (and a referenced workspace) is limited to 256 MiB, and its manifest to 16 MiB; an export that the browser could not open again is refused. These limits are accepted sizes, not a guarantee: on a laptop of 2026 (32 GiB of RAM, Chromium), capsules of about 130 MiB were exported, inspected and opened in 1.8 to 3.5 s each, and a 233 MiB capsule in up to 5.7 s, the page then using about 1.5 GiB of memory for the computation engine. Consulting a result stays immediate whatever the size; checking its data and verifying it take longer with larger arrays.

## 6. Adding a workspace instead of replacing it

In the interface, _File > Open HDF5 files…_ always replaces the current workspace and keeps the provenance of the file. _File > Browse HDF5 file…_ imports datasets as new objects: they have no recorded production (_Observed state, without recorded production_).

Scripts can add a workspace to the current one. The data are then added, but their earlier provenance is not imported, and DataLab-Web returns that notice. An added object never inherits the provenance of another object. To keep the provenance of a file, open it replacing the current workspace. DataLab Desktop asks before appending.

Even if an added object reuses the UUID of a deleted source or result, it does not inherit that object's evidence. Adding keeps the current record and capsule parent; replacing restores the opened workspace's provenance and origin.

## Capture scope and replay conditions

| Path                                                                                         | What is recorded                                                                                                    |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Ordinary/grouped processing, supported analyses, signal/image conversions and ROI extraction | Executions through the supported processor paths, with identity when the operation has a contract                   |
| Processing/Recompute or replay of a supported Desktop History computation                    | A new execution; verification itself creates no workspace result or activity                                        |
| Import/creation and direct edits of data, ROI or metadata                                    | No scientific call describing acquisition or arbitrary edits; states can be observed later without known production |
| Plugins, macros, notebooks, scripts and remote API clients                                   | The supported calculations they call, not every instruction or direct object modification                           |
| Desktop interactive fits and markers-table-to-signal                                         | Not currently recorded scientific calls; these Desktop paths are not Web features                                   |
| Discarded previews, errors and cancellations                                                 | Not successful executions; a successful detection that finds nothing is recorded normally                           |

Provenance capture is independent of the Desktop History **Record** mode: History is an editable recipe, provenance records executions. A function without a known contract can remain opaque. Old histories have unknown input states and possibly incomplete parameters or environments; their Python names are never used to execute them retroactively.

Replay requires a local contract qualified for the recorded version, usable parameters/context, available inputs and valid output references. The signal and image phase spectra remain identified but not qualified. Unknown operations, versions, codecs or policies produce explicit diagnostics; the reader does not download code to guess their meaning. See the [qualified environments and capture scope](https://github.com/DataLab-Platform/DataLab-Capsule/blob/develop/doc/interoperability.md).

Scientific fingerprints cover numerical data, types, coordinates and units, with ROI checked separately; titles, display and all other metadata are not automatically covered. Only declared dependencies such as global options, X alignment and metadata read by an operation are reproduced. For example, changed fit metadata needed by `evaluate_fit` can refuse replay even when the signal values match.

Verification runs one activity on copies, without changing the workspace. It neither reconstructs the whole chain nor restores missing states or supplies a workflow for new datasets. Reapplying from Processing uses current inputs and records a new execution. Recorded software versions are descriptions, not an automatic environment installer or a guarantee of reproducibility on every machine.

## Revisions, comparisons and reviews

A capsule is immutable and names at most one direct parent. Open A, export B, then export again: the proposed parent is still A, not B. Saving/reopening the HDF5 preserves that origin; inspecting another file or exporting a child does not move it. There is no automatic merge of concurrent work, simultaneous collaboration or generic conflict handling.

The local list keeps at most **100 manifests**, not all capsule files. Older entries are discarded; clearing browser storage removes this convenience list. Keep the actual capsule files separately. Desktop has the same limit in its local configuration folder.

Two exports or HDF5 saves may have different fingerprints without a new calculation, because storage, dates or presentation changed. `none_detected` means no scientific change detected in the recorded activities and states, not equality of all unrecorded content. A protocol changed in an attachment is listed under `attachments`; its scientific significance is for the reader to judge.

Reports and reviews are separate documents targeting one revision. Their consistency and target are checked, but a supplied assertion remains its author's claim, not local replay or a complete approval workflow. The reference registry holds manifests, reviews and light attachments, not workspaces or scientific computation. It has no accounts, strong author identity, quotas, rate limiting, deletion API or fine-grained permissions; its publishing token does not authenticate scientific authors.

## File policies and trust boundaries

| Consumer           | Accepted workspace / manifest | Other limits                                   |
| ------------------ | ----------------------------- | ---------------------------------------------- |
| Web                | 256 MiB / 16 MiB              | Archive 256 MiB; 8 attachments of 16 MiB each  |
| Desktop/library    | 4 GiB / 64 MiB                | Separate archive total; same attachment limits |
| Reference registry | No workspace / 8 MiB          | Review 1 MiB, attachment 16 MiB                |

These are policies, not guaranteed capacities; a valid file can exceed another edition's limit. Export may keep several representations of the archive and HDF5 in memory. The ledger also has JSON volume and structural protections, even without a fixed activity-count limit. See the [technical limits and contextualized measurements](https://github.com/DataLab-Platform/DataLab-Capsule/blob/develop/doc/performance.md).

The optional `workspace-capsule verify` CLI never runs Sigima. Without h5py it checks workspace size and SHA-256 only (`integrity_only`), not individual stored HDF5 states. A missing referenced workspace further limits what it can check.

Fingerprints detect changes but do not authenticate an author: capsules and reviews are unsigned, and an author can recompute fingerprints after editing. Import/inspection never executes received macros, notebooks, attachments or Python names. Explicit replay resolves locally installed, qualified operations, not embedded code. A notebook attachment is not evidence that its cells were replayed.

Profile 0.1 is experimental; unknown versions are refused. It prescribes native supported workspaces and an archive structure, not arbitrary ZIP/HDF5 files. ZIP entries are stored without compression (independent of internal HDF5 compression); links and encrypted archives are refused. RO-Crate/PROV does not guarantee restoration or replay by every third-party reader.

Format checks are not a universal sandbox: HDF5 parsing and dependencies remain trusted code. The Desktop does not have the WebAssembly confinement of the Web. The software licence does not license the data; the manifest declares a workspace licence, defaulting to "No licence was specified for this workspace." See the [common rules](https://github.com/DataLab-Platform/DataLab-Capsule/blob/develop/doc/rules.md) and [security and privacy limits](https://github.com/DataLab-Platform/DataLab-Capsule/blob/develop/doc/security.md).

Exchange needs no registry, but that does not make Web startup offline: the browser downloads its runtime and some optional packages at first use. Desktop and the CLI can work offline once installed; computations remain local.

## What provenance does not do

- **It does not keep every earlier array.** Earlier states are described by their fingerprints. Their data remain available only while an object holds them.
- **It does not clean up the workspace.** Trials and intermediate objects stay until you remove them, but their recorded steps remain. Deleting an object never purges the record or sensitive information.
- **It does not make everything verifiable.** Changes made outside recorded processing (data edited or imported, operations unknown to the computation library, such as some plugins) appear as observed states or opaque operations: they are described, never replayed.
- **It is not a proof of scientific validity.** _Exact_ or _Within tolerance_ says that the recorded computation is reproduced under the rule declared for that operation. It does not say that the processing was the right one.
- **It does not identify the author.** Fingerprints show that the content was not altered. They do not authenticate who produced it: capsules are not signed.

## Learn more

- The DataLab Desktop documentation describes the same features in its _Provenance of results_ and _Workspace capsules_ pages: <https://datalab-platform.com/>.
- [DataLab-Capsule](https://github.com/DataLab-Platform/DataLab-Capsule) describes the capsule format, the two-operator scenario between DataLab Desktop and DataLab-Web, and the comparison rules.
