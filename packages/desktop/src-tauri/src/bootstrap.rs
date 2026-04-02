use std::{env, fs, io, path::{Path, PathBuf}};

const BUNDLED_ASSETS: &[(&str, &str)] = &[
    ("oco.jsonc", include_str!("../../../../config/oco.jsonc")),
    ("prompts/pm.txt", include_str!("../../../../config/prompts/pm.txt")),
    (
        "prompts/orchestrator.txt",
        include_str!("../../../../config/prompts/orchestrator.txt"),
    ),
    (
        "prompts/investigator.txt",
        include_str!("../../../../config/prompts/investigator.txt"),
    ),
    (
        "prompts/auditor.txt",
        include_str!("../../../../config/prompts/auditor.txt"),
    ),
    (
        "prompts/web-search.txt",
        include_str!("../../../../config/prompts/web-search.txt"),
    ),
    ("prompts/docs.txt", include_str!("../../../../config/prompts/docs.txt")),
    (
        "prompts/compaction.txt",
        include_str!("../../../../config/prompts/compaction.txt"),
    ),
    (
        "skill/agents-md/SKILL.md",
        include_str!("../../../../config/skills/agents-md/SKILL.md"),
    ),
    (
        "skill/agents-md/references/detection-patterns.md",
        include_str!("../../../../config/skills/agents-md/references/detection-patterns.md"),
    ),
    (
        "skill/agents-md/references/examples.md",
        include_str!("../../../../config/skills/agents-md/references/examples.md"),
    ),
    (
        "skill/skill-creator/SKILL.md",
        include_str!("../../../../config/skills/skill-creator/SKILL.md"),
    ),
    (
        "skill/skill-creator/references/schemas.md",
        include_str!("../../../../config/skills/skill-creator/references/schemas.md"),
    ),
];

pub fn seed_oco_user_assets() -> io::Result<PathBuf> {
    let root = sidecar_config_dir()?;
    seed_oco_user_assets_into(&root)?;
    Ok(root)
}

fn seed_oco_user_assets_into(root: &Path) -> io::Result<()> {
    fs::create_dir_all(root)?;

    for (relative_path, contents) in BUNDLED_ASSETS {
        let destination = root.join(relative_path);
        if destination.exists() {
            continue;
        }

        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)?;
        }

        fs::write(destination, contents)?;
    }

    Ok(())
}

fn sidecar_config_dir() -> io::Result<PathBuf> {
    if let Some(xdg_config_home) = env::var_os("XDG_CONFIG_HOME")
        && !xdg_config_home.is_empty()
    {
        return Ok(PathBuf::from(xdg_config_home).join("oco"));
    }

    #[cfg(target_os = "windows")]
    {
        return dirs::config_dir()
            .map(|dir| dir.join("oco"))
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "cannot determine config directory"));
    }

    dirs::home_dir()
        .map(|home| home.join(".config").join("oco"))
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "cannot determine home directory"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_root() -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time before unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("oco-bootstrap-test-{unique}"))
    }

    #[test]
    fn seeds_missing_assets_without_overwriting_existing_files() {
        let root = temp_root();
        fs::create_dir_all(root.join("skill/agents-md")).expect("create test dirs");
        fs::write(root.join("oco.jsonc"), "custom-config").expect("write existing config");
        fs::write(root.join("skill/agents-md/SKILL.md"), "custom-skill").expect("write existing skill");

        seed_oco_user_assets_into(&root).expect("seed assets");

        assert_eq!(fs::read_to_string(root.join("oco.jsonc")).unwrap(), "custom-config");
        assert_eq!(
            fs::read_to_string(root.join("skill/agents-md/SKILL.md")).unwrap(),
            "custom-skill"
        );
        assert!(root.join("prompts/pm.txt").exists());
        assert!(root.join("skill/skill-creator/SKILL.md").exists());

        let _ = fs::remove_dir_all(root);
    }
}
