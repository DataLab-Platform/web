window.BENCHMARK_DATA = {
  "lastUpdate": 1786473739359,
  "repoUrl": "https://github.com/DataLab-Platform/web",
  "entries": {
    "DataLab-Web perf (deterministic)": [
      {
        "commit": {
          "author": {
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut",
            "email": "1311787+PierreRaybaut@users.noreply.github.com"
          },
          "committer": {
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut",
            "email": "1311787+PierreRaybaut@users.noreply.github.com"
          },
          "id": "d13eb8a321471a469b0913bb86ab31729abcf24d",
          "message": "fix: align View action locale types with SupportedLocale\n\ntsc -b failed because buildViewActions typed the locale code as plain\nstring, rejecting the i18n SupportedLocale values and the readonly\navailableLocales array passed from App.\n\nAssisted-by: Claude Opus 4.8",
          "timestamp": "2026-06-26T09:46:40Z",
          "url": "https://github.com/DataLab-Platform/web/commit/d13eb8a321471a469b0913bb86ab31729abcf24d"
        },
        "date": 1782468348834,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · payload (4 imgs)",
            "value": 33.21,
            "unit": "MB"
          },
          {
            "name": "opfs_storage · disk Δheap [1024² ×16 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · ram Δheap [1024² ×16 float64]",
            "value": 130.4,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk Δheap [2048² ×8 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · ram Δheap [2048² ×8 float64]",
            "value": 74.3,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [1024² ×16 float64]",
            "value": 35.8,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [1024² ×16 float64]",
            "value": 35.8,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [2048² ×8 float64]",
            "value": 94.6,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [2048² ×8 float64]",
            "value": 94.6,
            "unit": "MiB"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "committer": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "distinct": true,
          "id": "d13eb8a321471a469b0913bb86ab31729abcf24d",
          "message": "fix: align View action locale types with SupportedLocale\n\ntsc -b failed because buildViewActions typed the locale code as plain\nstring, rejecting the i18n SupportedLocale values and the readonly\navailableLocales array passed from App.\n\nAssisted-by: Claude Opus 4.8",
          "timestamp": "2026-06-26T11:46:40+02:00",
          "tree_id": "fe39f3917de53393e64010e8e61ce27dbeacc946",
          "url": "https://github.com/DataLab-Platform/web/commit/d13eb8a321471a469b0913bb86ab31729abcf24d"
        },
        "date": 1782469465540,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · payload (4 imgs)",
            "value": 33.21,
            "unit": "MB"
          },
          {
            "name": "opfs_storage · disk Δheap [1024² ×16 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · ram Δheap [1024² ×16 float64]",
            "value": 130.4,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk Δheap [2048² ×8 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · ram Δheap [2048² ×8 float64]",
            "value": 74.3,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [1024² ×16 float64]",
            "value": 35.8,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [1024² ×16 float64]",
            "value": 35.8,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [2048² ×8 float64]",
            "value": 94.6,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [2048² ×8 float64]",
            "value": 94.6,
            "unit": "MiB"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "committer": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "distinct": false,
          "id": "d13eb8a321471a469b0913bb86ab31729abcf24d",
          "message": "fix: align View action locale types with SupportedLocale\n\ntsc -b failed because buildViewActions typed the locale code as plain\nstring, rejecting the i18n SupportedLocale values and the readonly\navailableLocales array passed from App.\n\nAssisted-by: Claude Opus 4.8",
          "timestamp": "2026-06-26T11:46:40+02:00",
          "tree_id": "fe39f3917de53393e64010e8e61ce27dbeacc946",
          "url": "https://github.com/DataLab-Platform/web/commit/d13eb8a321471a469b0913bb86ab31729abcf24d"
        },
        "date": 1782473105095,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · payload (4 imgs)",
            "value": 33.21,
            "unit": "MB"
          },
          {
            "name": "opfs_storage · disk Δheap [1024² ×16 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · ram Δheap [1024² ×16 float64]",
            "value": 130.4,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk Δheap [2048² ×8 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · ram Δheap [2048² ×8 float64]",
            "value": 74.3,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [1024² ×16 float64]",
            "value": 35.8,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [1024² ×16 float64]",
            "value": 35.8,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [2048² ×8 float64]",
            "value": 94.6,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [2048² ×8 float64]",
            "value": 94.6,
            "unit": "MiB"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "committer": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "distinct": true,
          "id": "5cfdfc3f9e552c178fbe7f3474c97e48bd45e8bb",
          "message": "feat: add isDiskStorageSupported instance method to RuntimeApi and update benchmarks",
          "timestamp": "2026-06-26T17:47:02+02:00",
          "tree_id": "f7bd2772c258e9338b2e05e27a90df5f6b36094d",
          "url": "https://github.com/DataLab-Platform/web/commit/5cfdfc3f9e552c178fbe7f3474c97e48bd45e8bb"
        },
        "date": 1782489008255,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · payload (4 imgs)",
            "value": 33.21,
            "unit": "MB"
          },
          {
            "name": "opfs_storage · disk Δheap [1024² ×16 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · ram Δheap [1024² ×16 float64]",
            "value": 130.4,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk Δheap [2048² ×8 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · ram Δheap [2048² ×8 float64]",
            "value": 74.3,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [1024² ×16 float64]",
            "value": 35.8,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [1024² ×16 float64]",
            "value": 35.8,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [2048² ×8 float64]",
            "value": 94.6,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [2048² ×8 float64]",
            "value": 94.6,
            "unit": "MiB"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "committer": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "distinct": true,
          "id": "6206853b532a1840d95602e4595e2327cc4ac281",
          "message": "feat: add theme option for demo GIF recording and update tests for theme handling",
          "timestamp": "2026-07-01T19:01:11+02:00",
          "tree_id": "5b0facc43bfa27aeaf7d6c1812cc3e313582e756",
          "url": "https://github.com/DataLab-Platform/web/commit/6206853b532a1840d95602e4595e2327cc4ac281"
        },
        "date": 1782925474341,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · payload (4 imgs)",
            "value": 33.21,
            "unit": "MB"
          },
          {
            "name": "opfs_storage · disk Δheap [1024² ×16 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · ram Δheap [1024² ×16 float64]",
            "value": 130.4,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk Δheap [2048² ×8 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · ram Δheap [2048² ×8 float64]",
            "value": 74.3,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [1024² ×16 float64]",
            "value": 35.8,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [1024² ×16 float64]",
            "value": 35.8,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [2048² ×8 float64]",
            "value": 94.6,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [2048² ×8 float64]",
            "value": 94.6,
            "unit": "MiB"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "committer": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "distinct": true,
          "id": "c98dcc027f68a1aa19af311c20abd28dd0070e18",
          "message": "fix: keep command palette search results relevant for short queries\n\nFixes #8",
          "timestamp": "2026-07-08T19:05:30+02:00",
          "tree_id": "16a7a401d06607ee5bb0fcbad459cff8675f1958",
          "url": "https://github.com/DataLab-Platform/web/commit/c98dcc027f68a1aa19af311c20abd28dd0070e18"
        },
        "date": 1783530546346,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · payload (4 imgs)",
            "value": 33.21,
            "unit": "MB"
          },
          {
            "name": "opfs_storage · disk Δheap [1024² ×16 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · ram Δheap [1024² ×16 float64]",
            "value": 130.4,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk Δheap [2048² ×8 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · ram Δheap [2048² ×8 float64]",
            "value": 74.3,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [1024² ×16 float64]",
            "value": 35.8,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [1024² ×16 float64]",
            "value": 35.8,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [2048² ×8 float64]",
            "value": 94.6,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [2048² ×8 float64]",
            "value": 94.6,
            "unit": "MiB"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "committer": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "distinct": true,
          "id": "493884fa0b61823b5d39cebcfb597dab4d883cc3",
          "message": "fix: clarify file destination when saving or exporting\n\nPrefer the native \"Save as…\" picker (Chromium) for every save/export\naction, with a non-modal toast confirming the destination when\nbrowsers fall back to a plain download; warn before \"Save to\ndirectory\" silently falls back the same way.\n\nFixes #7",
          "timestamp": "2026-07-08T19:12:34+02:00",
          "tree_id": "e544117fd9bf2044a00235f89740aac10e0ccf96",
          "url": "https://github.com/DataLab-Platform/web/commit/493884fa0b61823b5d39cebcfb597dab4d883cc3"
        },
        "date": 1783530965968,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · payload (4 imgs)",
            "value": 33.21,
            "unit": "MB"
          },
          {
            "name": "opfs_storage · disk Δheap [1024² ×16 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · ram Δheap [1024² ×16 float64]",
            "value": 130.4,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk Δheap [2048² ×8 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · ram Δheap [2048² ×8 float64]",
            "value": 74.3,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [1024² ×16 float64]",
            "value": 35.8,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [1024² ×16 float64]",
            "value": 35.8,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [2048² ×8 float64]",
            "value": 94.6,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [2048² ×8 float64]",
            "value": 94.6,
            "unit": "MiB"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "committer": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "distinct": true,
          "id": "510626ea2db738605275d22921c7978b3f4b2586",
          "message": "fix: install tifffile so TIFF images can be saved and opened",
          "timestamp": "2026-07-08T19:37:40+02:00",
          "tree_id": "499fe11e59a91c283c06217b0763b5d9213ab76a",
          "url": "https://github.com/DataLab-Platform/web/commit/510626ea2db738605275d22921c7978b3f4b2586"
        },
        "date": 1783532451816,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · payload (4 imgs)",
            "value": 33.21,
            "unit": "MB"
          },
          {
            "name": "opfs_storage · disk Δheap [1024² ×16 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · ram Δheap [1024² ×16 float64]",
            "value": 156.4,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk Δheap [2048² ×8 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · ram Δheap [2048² ×8 float64]",
            "value": 163.4,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [1024² ×16 float64]",
            "value": 43,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [1024² ×16 float64]",
            "value": 43,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [2048² ×8 float64]",
            "value": 51.6,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [2048² ×8 float64]",
            "value": 51.6,
            "unit": "MiB"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "committer": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "distinct": true,
          "id": "973e154661e0bff12bda41632816b906e31a335f",
          "message": "chore(perf): track ram Δheap as trend-only, not a determinist gate\n\nRAM-mode peak heap growth holds the full working set and is\nallocator-dependent, so single-sample swings trigger false regressions.\nKeep disk Δheap as the deterministic guard.",
          "timestamp": "2026-07-09T11:05:09+02:00",
          "tree_id": "7f6bafeabdab75dcb31f215e9e28de51a02fc773",
          "url": "https://github.com/DataLab-Platform/web/commit/973e154661e0bff12bda41632816b906e31a335f"
        },
        "date": 1783588715543,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · payload (4 imgs)",
            "value": 33.21,
            "unit": "MB"
          },
          {
            "name": "opfs_storage · disk Δheap [1024² ×16 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk Δheap [2048² ×8 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [1024² ×16 float64]",
            "value": 43,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [1024² ×16 float64]",
            "value": 43,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [2048² ×8 float64]",
            "value": 51.6,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [2048² ×8 float64]",
            "value": 51.6,
            "unit": "MiB"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "committer": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "distinct": true,
          "id": "5be99ea07c1e42d18a29e68adf6a90cd88ce7331",
          "message": "fix: stringify HDF5 reference attributes in the h5 browser\n\nFixes #9",
          "timestamp": "2026-07-15T10:06:10+02:00",
          "tree_id": "776831a055c37ae9550fcd8cd8d417eed1aa6b08",
          "url": "https://github.com/DataLab-Platform/web/commit/5be99ea07c1e42d18a29e68adf6a90cd88ce7331"
        },
        "date": 1784102963650,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · payload (4 imgs)",
            "value": 33.21,
            "unit": "MB"
          },
          {
            "name": "opfs_storage · disk Δheap [1024² ×16 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk Δheap [2048² ×8 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [1024² ×16 float64]",
            "value": 43,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [1024² ×16 float64]",
            "value": 43,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [2048² ×8 float64]",
            "value": 51.6,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [2048² ×8 float64]",
            "value": 51.6,
            "unit": "MiB"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "committer": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "distinct": true,
          "id": "7495830b900a531c4bc19f3c3e99424abacc7a5a",
          "message": "update changelog",
          "timestamp": "2026-07-15T10:46:28+02:00",
          "tree_id": "fabc1128ea257b4094ba4e9c78d341de24b3684c",
          "url": "https://github.com/DataLab-Platform/web/commit/7495830b900a531c4bc19f3c3e99424abacc7a5a"
        },
        "date": 1784105387052,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · payload (4 imgs)",
            "value": 33.21,
            "unit": "MB"
          },
          {
            "name": "opfs_storage · disk Δheap [1024² ×16 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk Δheap [2048² ×8 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [1024² ×16 float64]",
            "value": 43,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [1024² ×16 float64]",
            "value": 43.1,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [2048² ×8 float64]",
            "value": 51.6,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [2048² ×8 float64]",
            "value": 51.7,
            "unit": "MiB"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "committer": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "distinct": true,
          "id": "71eed641280b97d8886af60bf7590b0905256a00",
          "message": "feat(image): default to outlier-eliminated contrast (match desktop)\n\nImages now open with the central 98% of the histogram mass, mirroring\ndesktop's ima_eliminate_outliers (2%) instead of raw min/max, which\ncould wash out contrast on a few extreme pixels. Auto button resets to\nthe same range.",
          "timestamp": "2026-07-15T14:21:30+02:00",
          "tree_id": "455cd23d190cd617305224e2a4fe68e6b1d18bf4",
          "url": "https://github.com/DataLab-Platform/web/commit/71eed641280b97d8886af60bf7590b0905256a00"
        },
        "date": 1784118290218,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · payload (4 imgs)",
            "value": 33.21,
            "unit": "MB"
          },
          {
            "name": "opfs_storage · disk Δheap [1024² ×16 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk Δheap [2048² ×8 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [1024² ×16 float64]",
            "value": 43,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [1024² ×16 float64]",
            "value": 43,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [2048² ×8 float64]",
            "value": 51.6,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [2048² ×8 float64]",
            "value": 51.6,
            "unit": "MiB"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "committer": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "distinct": true,
          "id": "fa72c58e644fe752637510846b30d5c16438ebd8",
          "message": "feat(demo): enhance GIF generation with lossless frame capture and quality options",
          "timestamp": "2026-07-18T11:09:40+02:00",
          "tree_id": "4cde73033333448da8b3020e85c2f2f254910df6",
          "url": "https://github.com/DataLab-Platform/web/commit/fa72c58e644fe752637510846b30d5c16438ebd8"
        },
        "date": 1784365982865,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · payload (4 imgs)",
            "value": 33.21,
            "unit": "MB"
          },
          {
            "name": "opfs_storage · disk Δheap [1024² ×16 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk Δheap [2048² ×8 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [1024² ×16 float64]",
            "value": 43,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [1024² ×16 float64]",
            "value": 43,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [2048² ×8 float64]",
            "value": 51.6,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [2048² ×8 float64]",
            "value": 51.6,
            "unit": "MiB"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "committer": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "distinct": true,
          "id": "31cf3779e4d4bcc4956b00aedae4d7f6262b09f9",
          "message": "v0.6.3",
          "timestamp": "2026-07-18T11:15:05+02:00",
          "tree_id": "4aab9fb2756ea450d019b9dc688335cf5814632b",
          "url": "https://github.com/DataLab-Platform/web/commit/31cf3779e4d4bcc4956b00aedae4d7f6262b09f9"
        },
        "date": 1784366308277,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · payload (4 imgs)",
            "value": 33.21,
            "unit": "MB"
          },
          {
            "name": "opfs_storage · disk Δheap [1024² ×16 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk Δheap [2048² ×8 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [1024² ×16 float64]",
            "value": 43,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [1024² ×16 float64]",
            "value": 43,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [2048² ×8 float64]",
            "value": 51.6,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [2048² ×8 float64]",
            "value": 51.6,
            "unit": "MiB"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "committer": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "distinct": true,
          "id": "31cf3779e4d4bcc4956b00aedae4d7f6262b09f9",
          "message": "v0.6.3",
          "timestamp": "2026-07-18T11:15:05+02:00",
          "tree_id": "4aab9fb2756ea450d019b9dc688335cf5814632b",
          "url": "https://github.com/DataLab-Platform/web/commit/31cf3779e4d4bcc4956b00aedae4d7f6262b09f9"
        },
        "date": 1784366323594,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · payload (4 imgs)",
            "value": 33.21,
            "unit": "MB"
          },
          {
            "name": "opfs_storage · disk Δheap [1024² ×16 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk Δheap [2048² ×8 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [1024² ×16 float64]",
            "value": 43,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [1024² ×16 float64]",
            "value": 43,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [2048² ×8 float64]",
            "value": 51.6,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [2048² ×8 float64]",
            "value": 51.6,
            "unit": "MiB"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "committer": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "distinct": false,
          "id": "15720f092e23593256e1b5cd5968fed6c7153536",
          "message": "perf(startup): defer heavy runtime and plotting bundles\n\nLazy-load Plotly views and prewarm primary plots during Pyodide startup.\nKeep the main runtime, Python payloads, and CodeMirror out of worker startup.\nShare Plotly loading and extract lightweight OPFS capability detection.\nEnforce preload invariants and a 375 KiB gzip initial-JS budget at build time.",
          "timestamp": "2026-08-02T19:53:58+02:00",
          "tree_id": "6598aac9f33feb409071bcd0ea083b747df2d3a2",
          "url": "https://github.com/DataLab-Platform/web/commit/15720f092e23593256e1b5cd5968fed6c7153536"
        },
        "date": 1785696181771,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · payload (4 imgs)",
            "value": 16.777,
            "unit": "MB"
          },
          {
            "name": "signal_perf · payload [10000 pts]",
            "value": 0.16,
            "unit": "MB"
          },
          {
            "name": "signal_perf · Plotly points [10000 pts]",
            "value": 1101,
            "unit": "points"
          },
          {
            "name": "signal_perf · payload [100000 pts]",
            "value": 1.6,
            "unit": "MB"
          },
          {
            "name": "signal_perf · Plotly points [100000 pts]",
            "value": 1101,
            "unit": "points"
          },
          {
            "name": "signal_perf · payload [500000 pts]",
            "value": 8,
            "unit": "MB"
          },
          {
            "name": "signal_perf · Plotly points [500000 pts]",
            "value": 1102,
            "unit": "points"
          },
          {
            "name": "signal_perf · payload [1000000 pts]",
            "value": 16,
            "unit": "MB"
          },
          {
            "name": "signal_perf · Plotly points [1000000 pts]",
            "value": 1102,
            "unit": "points"
          },
          {
            "name": "opfs_storage · disk Δheap [1024² ×16 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk Δheap [2048² ×8 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [1024² ×16 float64]",
            "value": 44.2,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [1024² ×16 float64]",
            "value": 44,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [2048² ×8 float64]",
            "value": 53,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [2048² ×8 float64]",
            "value": 52.8,
            "unit": "MiB"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "committer": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "distinct": true,
          "id": "257b492c4d5dc1946319d5daabf404a21483b45b",
          "message": "fix(interactive-fit): enhance fit type handling and metadata validation",
          "timestamp": "2026-08-03T07:16:53+02:00",
          "tree_id": "1a77821349bcb71233fbf61fcc16d1b4834e8cca",
          "url": "https://github.com/DataLab-Platform/web/commit/257b492c4d5dc1946319d5daabf404a21483b45b"
        },
        "date": 1785734402050,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · payload (4 imgs)",
            "value": 16.777,
            "unit": "MB"
          },
          {
            "name": "signal_perf · payload [10000 pts]",
            "value": 0.16,
            "unit": "MB"
          },
          {
            "name": "signal_perf · Plotly points [10000 pts]",
            "value": 1101,
            "unit": "points"
          },
          {
            "name": "signal_perf · payload [100000 pts]",
            "value": 1.6,
            "unit": "MB"
          },
          {
            "name": "signal_perf · Plotly points [100000 pts]",
            "value": 1101,
            "unit": "points"
          },
          {
            "name": "signal_perf · payload [500000 pts]",
            "value": 8,
            "unit": "MB"
          },
          {
            "name": "signal_perf · Plotly points [500000 pts]",
            "value": 1102,
            "unit": "points"
          },
          {
            "name": "signal_perf · payload [1000000 pts]",
            "value": 16,
            "unit": "MB"
          },
          {
            "name": "signal_perf · Plotly points [1000000 pts]",
            "value": 1102,
            "unit": "points"
          },
          {
            "name": "opfs_storage · disk Δheap [1024² ×16 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk Δheap [2048² ×8 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [1024² ×16 float64]",
            "value": 44,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [1024² ×16 float64]",
            "value": 44.2,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [2048² ×8 float64]",
            "value": 52.8,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [2048² ×8 float64]",
            "value": 53,
            "unit": "MiB"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "committer": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "distinct": false,
          "id": "a24827dd60a2aca9d5c0a856f631a60ae47895c5",
          "message": "fix: restore faithful LOD rendering and import panel routing\n\nKeep the current spatial image at full resolution while bounding previews.\nResync signal LOD after Plotly resizes and stabilize related E2E checks.\nRoute imported objects to their matching panel before selecting them.",
          "timestamp": "2026-08-03T08:43:54+02:00",
          "tree_id": "f0597019682f6c1fe0c35ca4ad6be1ef419425b4",
          "url": "https://github.com/DataLab-Platform/web/commit/a24827dd60a2aca9d5c0a856f631a60ae47895c5"
        },
        "date": 1785739688602,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · payload (4 imgs)",
            "value": 16.777,
            "unit": "MB"
          },
          {
            "name": "signal_perf · payload [10000 pts]",
            "value": 0.16,
            "unit": "MB"
          },
          {
            "name": "signal_perf · Plotly points [10000 pts]",
            "value": 1061,
            "unit": "points"
          },
          {
            "name": "signal_perf · payload [100000 pts]",
            "value": 1.6,
            "unit": "MB"
          },
          {
            "name": "signal_perf · Plotly points [100000 pts]",
            "value": 1061,
            "unit": "points"
          },
          {
            "name": "signal_perf · payload [500000 pts]",
            "value": 8,
            "unit": "MB"
          },
          {
            "name": "signal_perf · Plotly points [500000 pts]",
            "value": 1062,
            "unit": "points"
          },
          {
            "name": "signal_perf · payload [1000000 pts]",
            "value": 16,
            "unit": "MB"
          },
          {
            "name": "signal_perf · Plotly points [1000000 pts]",
            "value": 1062,
            "unit": "points"
          },
          {
            "name": "opfs_storage · disk Δheap [1024² ×16 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk Δheap [2048² ×8 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [1024² ×16 float64]",
            "value": 44.2,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [1024² ×16 float64]",
            "value": 44,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [2048² ×8 float64]",
            "value": 53,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [2048² ×8 float64]",
            "value": 52.8,
            "unit": "MiB"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "committer": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "distinct": true,
          "id": "12440460f065ed46fc5f7be796d1b8497d377231",
          "message": "fix(signal-plot): restore large-signal rendering performance\n\nPreserve Plotly's historical revision for single-signal views to avoid full\ntrace reconciliation. This reduces 1M-point selection from ~360 ms to ~80 ms\nwhile retaining the new revision semantics for multi-signal layouts.",
          "timestamp": "2026-08-03T11:34:27+02:00",
          "tree_id": "298ef88abc0607b21a96f9e4fa72d76895019f17",
          "url": "https://github.com/DataLab-Platform/web/commit/12440460f065ed46fc5f7be796d1b8497d377231"
        },
        "date": 1785749884301,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · payload (4 imgs)",
            "value": 16.777,
            "unit": "MB"
          },
          {
            "name": "signal_perf · payload [10000 pts]",
            "value": 0.16,
            "unit": "MB"
          },
          {
            "name": "signal_perf · Plotly points [10000 pts]",
            "value": 1061,
            "unit": "points"
          },
          {
            "name": "signal_perf · payload [100000 pts]",
            "value": 1.6,
            "unit": "MB"
          },
          {
            "name": "signal_perf · Plotly points [100000 pts]",
            "value": 1061,
            "unit": "points"
          },
          {
            "name": "signal_perf · payload [500000 pts]",
            "value": 8,
            "unit": "MB"
          },
          {
            "name": "signal_perf · Plotly points [500000 pts]",
            "value": 1062,
            "unit": "points"
          },
          {
            "name": "signal_perf · payload [1000000 pts]",
            "value": 16,
            "unit": "MB"
          },
          {
            "name": "signal_perf · Plotly points [1000000 pts]",
            "value": 1062,
            "unit": "points"
          },
          {
            "name": "opfs_storage · disk Δheap [1024² ×16 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk Δheap [2048² ×8 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [1024² ×16 float64]",
            "value": 44.2,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [1024² ×16 float64]",
            "value": 44.6,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [2048² ×8 float64]",
            "value": 53,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [2048² ×8 float64]",
            "value": 53.4,
            "unit": "MiB"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "committer": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "distinct": true,
          "id": "8ec94c0933aa13d876db4c3a9fb1aff7be3b1440",
          "message": "test(perf): stabilize signal fetch benchmarks\n\nWarm up each fetch and report the median of five measured transfers.\nKeep all samples in raw artifacts, but track only stable 500k and 1M\ntimings under a renamed series to prevent false performance alerts.",
          "timestamp": "2026-08-03T11:54:46+02:00",
          "tree_id": "bceb61ca928f9e6c80b13ac8ef92f64286598900",
          "url": "https://github.com/DataLab-Platform/web/commit/8ec94c0933aa13d876db4c3a9fb1aff7be3b1440"
        },
        "date": 1785751080353,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · payload (4 imgs)",
            "value": 16.777,
            "unit": "MB"
          },
          {
            "name": "signal_perf · payload [10000 pts]",
            "value": 0.16,
            "unit": "MB"
          },
          {
            "name": "signal_perf · Plotly points [10000 pts]",
            "value": 1061,
            "unit": "points"
          },
          {
            "name": "signal_perf · payload [100000 pts]",
            "value": 1.6,
            "unit": "MB"
          },
          {
            "name": "signal_perf · Plotly points [100000 pts]",
            "value": 1061,
            "unit": "points"
          },
          {
            "name": "signal_perf · payload [500000 pts]",
            "value": 8,
            "unit": "MB"
          },
          {
            "name": "signal_perf · Plotly points [500000 pts]",
            "value": 1062,
            "unit": "points"
          },
          {
            "name": "signal_perf · payload [1000000 pts]",
            "value": 16,
            "unit": "MB"
          },
          {
            "name": "signal_perf · Plotly points [1000000 pts]",
            "value": 1062,
            "unit": "points"
          },
          {
            "name": "opfs_storage · disk Δheap [1024² ×16 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk Δheap [2048² ×8 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [1024² ×16 float64]",
            "value": 44,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [1024² ×16 float64]",
            "value": 44,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [2048² ×8 float64]",
            "value": 52.8,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [2048² ×8 float64]",
            "value": 52.8,
            "unit": "MiB"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "committer": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "distinct": true,
          "id": "25854736dac0768b05ae67f4f92d196e3229a957",
          "message": "ci(perf): stop noisy timing alerts\n\nKeep wall-clock benchmarks in history and workflow summaries, but stop\nposting alerts for relative fluctuations on shared runners. Deterministic\nmemory and payload metrics remain actionable regression guards.",
          "timestamp": "2026-08-03T12:09:19+02:00",
          "tree_id": "ef2f6cae583d800ef30910eaabe5b4980ec6c13c",
          "url": "https://github.com/DataLab-Platform/web/commit/25854736dac0768b05ae67f4f92d196e3229a957"
        },
        "date": 1785751987685,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · payload (4 imgs)",
            "value": 16.777,
            "unit": "MB"
          },
          {
            "name": "signal_perf · payload [10000 pts]",
            "value": 0.16,
            "unit": "MB"
          },
          {
            "name": "signal_perf · Plotly points [10000 pts]",
            "value": 1061,
            "unit": "points"
          },
          {
            "name": "signal_perf · payload [100000 pts]",
            "value": 1.6,
            "unit": "MB"
          },
          {
            "name": "signal_perf · Plotly points [100000 pts]",
            "value": 1061,
            "unit": "points"
          },
          {
            "name": "signal_perf · payload [500000 pts]",
            "value": 8,
            "unit": "MB"
          },
          {
            "name": "signal_perf · Plotly points [500000 pts]",
            "value": 1062,
            "unit": "points"
          },
          {
            "name": "signal_perf · payload [1000000 pts]",
            "value": 16,
            "unit": "MB"
          },
          {
            "name": "signal_perf · Plotly points [1000000 pts]",
            "value": 1062,
            "unit": "points"
          },
          {
            "name": "opfs_storage · disk Δheap [1024² ×16 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk Δheap [2048² ×8 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [1024² ×16 float64]",
            "value": 44,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [1024² ×16 float64]",
            "value": 44.2,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [2048² ×8 float64]",
            "value": 52.8,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [2048² ×8 float64]",
            "value": 53,
            "unit": "MiB"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "committer": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "distinct": true,
          "id": "713769cc6d94f2e4b9e607faab79ab5cf6ecd29f",
          "message": "v0.7.0",
          "timestamp": "2026-08-03T16:53:49+02:00",
          "tree_id": "4175cadcbc6753895c48eb735a9bc694e1428565",
          "url": "https://github.com/DataLab-Platform/web/commit/713769cc6d94f2e4b9e607faab79ab5cf6ecd29f"
        },
        "date": 1785769078821,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · payload (4 imgs)",
            "value": 16.777,
            "unit": "MB"
          },
          {
            "name": "signal_perf · payload [10000 pts]",
            "value": 0.16,
            "unit": "MB"
          },
          {
            "name": "signal_perf · Plotly points [10000 pts]",
            "value": 1061,
            "unit": "points"
          },
          {
            "name": "signal_perf · payload [100000 pts]",
            "value": 1.6,
            "unit": "MB"
          },
          {
            "name": "signal_perf · Plotly points [100000 pts]",
            "value": 1061,
            "unit": "points"
          },
          {
            "name": "signal_perf · payload [500000 pts]",
            "value": 8,
            "unit": "MB"
          },
          {
            "name": "signal_perf · Plotly points [500000 pts]",
            "value": 1062,
            "unit": "points"
          },
          {
            "name": "signal_perf · payload [1000000 pts]",
            "value": 16,
            "unit": "MB"
          },
          {
            "name": "signal_perf · Plotly points [1000000 pts]",
            "value": 1062,
            "unit": "points"
          },
          {
            "name": "opfs_storage · disk Δheap [1024² ×16 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk Δheap [2048² ×8 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [1024² ×16 float64]",
            "value": 44.2,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [1024² ×16 float64]",
            "value": 44,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [2048² ×8 float64]",
            "value": 53,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [2048² ×8 float64]",
            "value": 52.8,
            "unit": "MiB"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "committer": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "distinct": true,
          "id": "713769cc6d94f2e4b9e607faab79ab5cf6ecd29f",
          "message": "v0.7.0",
          "timestamp": "2026-08-03T16:53:49+02:00",
          "tree_id": "4175cadcbc6753895c48eb735a9bc694e1428565",
          "url": "https://github.com/DataLab-Platform/web/commit/713769cc6d94f2e4b9e607faab79ab5cf6ecd29f"
        },
        "date": 1785770091349,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · payload (4 imgs)",
            "value": 16.777,
            "unit": "MB"
          },
          {
            "name": "signal_perf · payload [10000 pts]",
            "value": 0.16,
            "unit": "MB"
          },
          {
            "name": "signal_perf · Plotly points [10000 pts]",
            "value": 1061,
            "unit": "points"
          },
          {
            "name": "signal_perf · payload [100000 pts]",
            "value": 1.6,
            "unit": "MB"
          },
          {
            "name": "signal_perf · Plotly points [100000 pts]",
            "value": 1061,
            "unit": "points"
          },
          {
            "name": "signal_perf · payload [500000 pts]",
            "value": 8,
            "unit": "MB"
          },
          {
            "name": "signal_perf · Plotly points [500000 pts]",
            "value": 1062,
            "unit": "points"
          },
          {
            "name": "signal_perf · payload [1000000 pts]",
            "value": 16,
            "unit": "MB"
          },
          {
            "name": "signal_perf · Plotly points [1000000 pts]",
            "value": 1062,
            "unit": "points"
          },
          {
            "name": "opfs_storage · disk Δheap [1024² ×16 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk Δheap [2048² ×8 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [1024² ×16 float64]",
            "value": 44.6,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [1024² ×16 float64]",
            "value": 44.2,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [2048² ×8 float64]",
            "value": 53.4,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [2048² ×8 float64]",
            "value": 53,
            "unit": "MiB"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "committer": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "distinct": true,
          "id": "73bdb614428eeb206f7510ae6e6f1ed0a22b779d",
          "message": "feat: support mixed signal axis groups\n\nAdd a transactional axis organizer for shared and separate signal plots.\nPersist group assignments by object UUID and restore them across selections.\nSynchronize compatible X axes and share layouts with detached plot views.\nPreserve unique object UUIDs across creation, duplication, and HDF5 reloads.\nAdd French translations, release notes, and unit, Python, and E2E coverage.\n\nCloses #16",
          "timestamp": "2026-08-06T14:15:15+02:00",
          "tree_id": "da466b1f65dfdfd479efa0ecf0da2b3d9903de61",
          "url": "https://github.com/DataLab-Platform/web/commit/73bdb614428eeb206f7510ae6e6f1ed0a22b779d"
        },
        "date": 1786018745008,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · payload (4 imgs)",
            "value": 16.777,
            "unit": "MB"
          },
          {
            "name": "signal_perf · payload [10000 pts]",
            "value": 0.16,
            "unit": "MB"
          },
          {
            "name": "signal_perf · Plotly points [10000 pts]",
            "value": 1061,
            "unit": "points"
          },
          {
            "name": "signal_perf · payload [100000 pts]",
            "value": 1.6,
            "unit": "MB"
          },
          {
            "name": "signal_perf · Plotly points [100000 pts]",
            "value": 1061,
            "unit": "points"
          },
          {
            "name": "signal_perf · payload [500000 pts]",
            "value": 8,
            "unit": "MB"
          },
          {
            "name": "signal_perf · Plotly points [500000 pts]",
            "value": 1062,
            "unit": "points"
          },
          {
            "name": "signal_perf · payload [1000000 pts]",
            "value": 16,
            "unit": "MB"
          },
          {
            "name": "signal_perf · Plotly points [1000000 pts]",
            "value": 1062,
            "unit": "points"
          },
          {
            "name": "opfs_storage · disk Δheap [1024² ×16 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk Δheap [2048² ×8 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [1024² ×16 float64]",
            "value": 44.2,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [1024² ×16 float64]",
            "value": 44.2,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [2048² ×8 float64]",
            "value": 53,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [2048² ×8 float64]",
            "value": 53,
            "unit": "MiB"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "committer": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "distinct": true,
          "id": "16517c08b40b79f2498fd13f3515729eb815ca19",
          "message": "feat: add demo workspaces and preload functionality for deep linking",
          "timestamp": "2026-08-07T15:08:47+02:00",
          "tree_id": "7643062d7f5955b04ba3c4646228e3395b4bc0fb",
          "url": "https://github.com/DataLab-Platform/web/commit/16517c08b40b79f2498fd13f3515729eb815ca19"
        },
        "date": 1786108362704,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · payload (4 imgs)",
            "value": 16.777,
            "unit": "MB"
          },
          {
            "name": "signal_perf · payload [10000 pts]",
            "value": 0.16,
            "unit": "MB"
          },
          {
            "name": "signal_perf · Plotly points [10000 pts]",
            "value": 1061,
            "unit": "points"
          },
          {
            "name": "signal_perf · payload [100000 pts]",
            "value": 1.6,
            "unit": "MB"
          },
          {
            "name": "signal_perf · Plotly points [100000 pts]",
            "value": 1061,
            "unit": "points"
          },
          {
            "name": "signal_perf · payload [500000 pts]",
            "value": 8,
            "unit": "MB"
          },
          {
            "name": "signal_perf · Plotly points [500000 pts]",
            "value": 1062,
            "unit": "points"
          },
          {
            "name": "signal_perf · payload [1000000 pts]",
            "value": 16,
            "unit": "MB"
          },
          {
            "name": "signal_perf · Plotly points [1000000 pts]",
            "value": 1062,
            "unit": "points"
          },
          {
            "name": "opfs_storage · disk Δheap [1024² ×16 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk Δheap [2048² ×8 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [1024² ×16 float64]",
            "value": 44,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [1024² ×16 float64]",
            "value": 44.2,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [2048² ×8 float64]",
            "value": 52.8,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [2048² ×8 float64]",
            "value": 53,
            "unit": "MiB"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "committer": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "distinct": true,
          "id": "ef13d21501b58f1e1f77644f1371882b718bdc72",
          "message": "v0.8.0",
          "timestamp": "2026-08-07T15:27:13+02:00",
          "tree_id": "5577bcf7170616f7e9450f2efc0839cfbb4f4fe8",
          "url": "https://github.com/DataLab-Platform/web/commit/ef13d21501b58f1e1f77644f1371882b718bdc72"
        },
        "date": 1786109488029,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · payload (4 imgs)",
            "value": 16.777,
            "unit": "MB"
          },
          {
            "name": "signal_perf · payload [10000 pts]",
            "value": 0.16,
            "unit": "MB"
          },
          {
            "name": "signal_perf · Plotly points [10000 pts]",
            "value": 1061,
            "unit": "points"
          },
          {
            "name": "signal_perf · payload [100000 pts]",
            "value": 1.6,
            "unit": "MB"
          },
          {
            "name": "signal_perf · Plotly points [100000 pts]",
            "value": 1061,
            "unit": "points"
          },
          {
            "name": "signal_perf · payload [500000 pts]",
            "value": 8,
            "unit": "MB"
          },
          {
            "name": "signal_perf · Plotly points [500000 pts]",
            "value": 1062,
            "unit": "points"
          },
          {
            "name": "signal_perf · payload [1000000 pts]",
            "value": 16,
            "unit": "MB"
          },
          {
            "name": "signal_perf · Plotly points [1000000 pts]",
            "value": 1062,
            "unit": "points"
          },
          {
            "name": "opfs_storage · disk Δheap [1024² ×16 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk Δheap [2048² ×8 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [1024² ×16 float64]",
            "value": 44.2,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [1024² ×16 float64]",
            "value": 44,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [2048² ×8 float64]",
            "value": 53,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [2048² ×8 float64]",
            "value": 52.8,
            "unit": "MiB"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "committer": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "distinct": true,
          "id": "ef13d21501b58f1e1f77644f1371882b718bdc72",
          "message": "v0.8.0",
          "timestamp": "2026-08-07T15:27:13+02:00",
          "tree_id": "5577bcf7170616f7e9450f2efc0839cfbb4f4fe8",
          "url": "https://github.com/DataLab-Platform/web/commit/ef13d21501b58f1e1f77644f1371882b718bdc72"
        },
        "date": 1786109508821,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · payload (4 imgs)",
            "value": 16.777,
            "unit": "MB"
          },
          {
            "name": "signal_perf · payload [10000 pts]",
            "value": 0.16,
            "unit": "MB"
          },
          {
            "name": "signal_perf · Plotly points [10000 pts]",
            "value": 1061,
            "unit": "points"
          },
          {
            "name": "signal_perf · payload [100000 pts]",
            "value": 1.6,
            "unit": "MB"
          },
          {
            "name": "signal_perf · Plotly points [100000 pts]",
            "value": 1061,
            "unit": "points"
          },
          {
            "name": "signal_perf · payload [500000 pts]",
            "value": 8,
            "unit": "MB"
          },
          {
            "name": "signal_perf · Plotly points [500000 pts]",
            "value": 1062,
            "unit": "points"
          },
          {
            "name": "signal_perf · payload [1000000 pts]",
            "value": 16,
            "unit": "MB"
          },
          {
            "name": "signal_perf · Plotly points [1000000 pts]",
            "value": 1062,
            "unit": "points"
          },
          {
            "name": "opfs_storage · disk Δheap [1024² ×16 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk Δheap [2048² ×8 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [1024² ×16 float64]",
            "value": 44.2,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [1024² ×16 float64]",
            "value": 44,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [2048² ×8 float64]",
            "value": 53,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [2048² ×8 float64]",
            "value": 52.8,
            "unit": "MiB"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "committer": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "distinct": true,
          "id": "61e2a73b3b195b15cf1cc54a2190f1ef00f660c2",
          "message": "chore: release 0.9.0\n\nAssisted-by: GitHub Copilot",
          "timestamp": "2026-08-11T20:35:37+02:00",
          "tree_id": "182de90ce3432cb61bce1c2478c6b09bdf9b0622",
          "url": "https://github.com/DataLab-Platform/web/commit/61e2a73b3b195b15cf1cc54a2190f1ef00f660c2"
        },
        "date": 1786473734504,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · payload (4 imgs)",
            "value": 16.777,
            "unit": "MB"
          },
          {
            "name": "signal_perf · payload [10000 pts]",
            "value": 0.16,
            "unit": "MB"
          },
          {
            "name": "signal_perf · Plotly points [10000 pts]",
            "value": 1061,
            "unit": "points"
          },
          {
            "name": "signal_perf · payload [100000 pts]",
            "value": 1.6,
            "unit": "MB"
          },
          {
            "name": "signal_perf · Plotly points [100000 pts]",
            "value": 1061,
            "unit": "points"
          },
          {
            "name": "signal_perf · payload [500000 pts]",
            "value": 8,
            "unit": "MB"
          },
          {
            "name": "signal_perf · Plotly points [500000 pts]",
            "value": 1062,
            "unit": "points"
          },
          {
            "name": "signal_perf · payload [1000000 pts]",
            "value": 16,
            "unit": "MB"
          },
          {
            "name": "signal_perf · Plotly points [1000000 pts]",
            "value": 1062,
            "unit": "points"
          },
          {
            "name": "opfs_storage · disk Δheap [1024² ×16 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk Δheap [2048² ×8 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [1024² ×16 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [1024² ×16 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [2048² ×8 float64]",
            "value": 53.7,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [2048² ×8 float64]",
            "value": 53.7,
            "unit": "MiB"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "committer": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "distinct": true,
          "id": "61e2a73b3b195b15cf1cc54a2190f1ef00f660c2",
          "message": "chore: release 0.9.0\n\nAssisted-by: GitHub Copilot",
          "timestamp": "2026-08-11T20:35:37+02:00",
          "tree_id": "182de90ce3432cb61bce1c2478c6b09bdf9b0622",
          "url": "https://github.com/DataLab-Platform/web/commit/61e2a73b3b195b15cf1cc54a2190f1ef00f660c2"
        },
        "date": 1786473735074,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · payload (4 imgs)",
            "value": 16.777,
            "unit": "MB"
          },
          {
            "name": "signal_perf · payload [10000 pts]",
            "value": 0.16,
            "unit": "MB"
          },
          {
            "name": "signal_perf · Plotly points [10000 pts]",
            "value": 1061,
            "unit": "points"
          },
          {
            "name": "signal_perf · payload [100000 pts]",
            "value": 1.6,
            "unit": "MB"
          },
          {
            "name": "signal_perf · Plotly points [100000 pts]",
            "value": 1061,
            "unit": "points"
          },
          {
            "name": "signal_perf · payload [500000 pts]",
            "value": 8,
            "unit": "MB"
          },
          {
            "name": "signal_perf · Plotly points [500000 pts]",
            "value": 1062,
            "unit": "points"
          },
          {
            "name": "signal_perf · payload [1000000 pts]",
            "value": 16,
            "unit": "MB"
          },
          {
            "name": "signal_perf · Plotly points [1000000 pts]",
            "value": 1062,
            "unit": "points"
          },
          {
            "name": "opfs_storage · disk Δheap [1024² ×16 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk Δheap [2048² ×8 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [1024² ×16 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [1024² ×16 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [2048² ×8 float64]",
            "value": 53.7,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [2048² ×8 float64]",
            "value": 53.7,
            "unit": "MiB"
          }
        ]
      }
    ]
  }
}