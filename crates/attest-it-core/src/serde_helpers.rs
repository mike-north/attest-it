//! Shared serde helpers.

use serde::Deserializer;

/// Deserialize a version field that can be either a number (`1`) or a string (`"1"`).
/// This matches the TypeScript Zod schema behavior of `z.coerce.number()`.
pub fn deserialize_version<'de, D>(deserializer: D) -> Result<u32, D::Error>
where
    D: Deserializer<'de>,
{
    use serde::de;

    struct VersionVisitor;

    impl<'de> de::Visitor<'de> for VersionVisitor {
        type Value = u32;

        fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            formatter.write_str("a version number (integer or string)")
        }

        fn visit_u64<E: de::Error>(self, v: u64) -> Result<u32, E> {
            u32::try_from(v).map_err(|_| E::custom(format!("version {v} out of range for u32")))
        }

        fn visit_i64<E: de::Error>(self, v: i64) -> Result<u32, E> {
            u32::try_from(v).map_err(|_| E::custom(format!("version {v} out of range for u32")))
        }

        fn visit_str<E: de::Error>(self, v: &str) -> Result<u32, E> {
            v.parse::<u32>()
                .map_err(|_| E::custom(format!("cannot parse version \"{v}\" as integer")))
        }
    }

    deserializer.deserialize_any(VersionVisitor)
}
