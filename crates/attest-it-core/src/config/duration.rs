//! Duration string parsing.
//!
//! Parses human-readable duration strings matching the format used by the
//! `ms` npm package: `"30d"`, `"24h"`, `"5m"`, `"100ms"`, etc.

use crate::errors::AttestError;

/// Parse a duration string into milliseconds.
///
/// Supported units (case-insensitive):
/// - `ms` — milliseconds
/// - `s` — seconds
/// - `m` — minutes
/// - `h` — hours
/// - `d` — days
/// - `w` — weeks
/// - `y` — years (365.25 days)
///
/// # Examples
///
/// ```
/// use attest_it_core::config::duration::parse_duration_ms;
///
/// assert_eq!(parse_duration_ms("30d").unwrap(), 30 * 24 * 60 * 60 * 1000);
/// assert_eq!(parse_duration_ms("24h").unwrap(), 24 * 60 * 60 * 1000);
/// assert_eq!(parse_duration_ms("100ms").unwrap(), 100);
/// assert_eq!(parse_duration_ms("1.5h").unwrap(), 5_400_000);
/// ```
pub fn parse_duration_ms(input: &str) -> Result<u64, AttestError> {
    let input = input.trim();
    if input.is_empty() {
        return Err(AttestError::InvalidDuration {
            message: "empty duration string".to_owned(),
            input: input.to_owned(),
        });
    }

    // Find the boundary between the numeric part and the unit
    let lower = input.to_ascii_lowercase();

    // Try to match the unit suffix
    let (num_str, multiplier) = if let Some(n) = lower.strip_suffix("ms") {
        (n, 1u64)
    } else if let Some(n) = lower.strip_suffix('s') {
        (n, 1_000)
    } else if let Some(n) = lower.strip_suffix('m') {
        (n, 60 * 1_000)
    } else if let Some(n) = lower.strip_suffix('h') {
        (n, 60 * 60 * 1_000)
    } else if let Some(n) = lower.strip_suffix('d') {
        (n, 24 * 60 * 60 * 1_000)
    } else if let Some(n) = lower.strip_suffix('w') {
        (n, 7 * 24 * 60 * 60 * 1_000)
    } else if let Some(n) = lower.strip_suffix('y') {
        // 365.25 days
        (n, 365 * 24 * 60 * 60 * 1_000 + 6 * 60 * 60 * 1_000)
    } else {
        return Err(AttestError::InvalidDuration {
            message: format!("unrecognized duration unit in \"{input}\""),
            input: input.to_owned(),
        });
    };

    let num_str = num_str.trim();
    let value: f64 = num_str.parse().map_err(|_| AttestError::InvalidDuration {
        message: format!("invalid numeric value \"{num_str}\" in duration \"{input}\""),
        input: input.to_owned(),
    })?;

    if value <= 0.0 {
        return Err(AttestError::InvalidDuration {
            message: format!("duration must be positive, got \"{input}\""),
            input: input.to_owned(),
        });
    }

    #[expect(clippy::cast_sign_loss, reason = "value is checked non-negative above")]
    #[expect(
        clippy::cast_possible_truncation,
        reason = "duration values are small enough that truncation is acceptable"
    )]
    let ms = (value * multiplier as f64) as u64;
    Ok(ms)
}

/// Convert a duration string to days (convenience for `maxAgeDays` comparisons).
pub fn parse_duration_days(input: &str) -> Result<f64, AttestError> {
    let ms = parse_duration_ms(input)?;
    Ok(ms as f64 / (24.0 * 60.0 * 60.0 * 1000.0))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_milliseconds() {
        assert_eq!(parse_duration_ms("100ms").unwrap(), 100);
        assert_eq!(parse_duration_ms("1ms").unwrap(), 1);
    }

    #[test]
    fn test_seconds() {
        assert_eq!(parse_duration_ms("1s").unwrap(), 1_000);
        assert_eq!(parse_duration_ms("30s").unwrap(), 30_000);
    }

    #[test]
    fn test_minutes() {
        assert_eq!(parse_duration_ms("1m").unwrap(), 60_000);
        assert_eq!(parse_duration_ms("5m").unwrap(), 300_000);
    }

    #[test]
    fn test_hours() {
        assert_eq!(parse_duration_ms("1h").unwrap(), 3_600_000);
        assert_eq!(parse_duration_ms("24h").unwrap(), 86_400_000);
    }

    #[test]
    fn test_days() {
        assert_eq!(parse_duration_ms("1d").unwrap(), 86_400_000);
        assert_eq!(parse_duration_ms("30d").unwrap(), 2_592_000_000);
    }

    #[test]
    fn test_weeks() {
        assert_eq!(parse_duration_ms("1w").unwrap(), 604_800_000);
        assert_eq!(parse_duration_ms("2w").unwrap(), 1_209_600_000);
    }

    #[test]
    fn test_fractional() {
        assert_eq!(parse_duration_ms("1.5h").unwrap(), 5_400_000);
        assert_eq!(parse_duration_ms("0.5d").unwrap(), 43_200_000);
    }

    #[test]
    fn test_case_insensitive() {
        assert_eq!(parse_duration_ms("1D").unwrap(), 86_400_000);
        assert_eq!(parse_duration_ms("100MS").unwrap(), 100);
        assert_eq!(parse_duration_ms("1H").unwrap(), 3_600_000);
    }

    #[test]
    fn test_whitespace_trimming() {
        assert_eq!(parse_duration_ms(" 1d ").unwrap(), 86_400_000);
    }

    #[test]
    fn test_invalid_empty() {
        assert!(parse_duration_ms("").is_err());
    }

    #[test]
    fn test_invalid_no_unit() {
        assert!(parse_duration_ms("100").is_err());
    }

    #[test]
    fn test_invalid_no_number() {
        assert!(parse_duration_ms("d").is_err());
    }

    #[test]
    fn test_years() {
        // 365.25 days = 365 * 24 * 60 * 60 * 1000 + 6 * 60 * 60 * 1000
        assert_eq!(
            parse_duration_ms("1y").unwrap(),
            365 * 24 * 60 * 60 * 1_000 + 6 * 60 * 60 * 1_000
        );
    }

    #[test]
    fn test_invalid_negative() {
        assert!(parse_duration_ms("-1d").is_err());
    }

    #[test]
    fn test_invalid_zero() {
        // Zero duration is semantically invalid (matches TypeScript durationSchema behavior)
        assert!(parse_duration_ms("0ms").is_err());
        assert!(parse_duration_ms("0d").is_err());
    }

    #[test]
    fn test_duration_days() {
        let days = parse_duration_days("30d").unwrap();
        assert!((days - 30.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_duration_days_fractional() {
        let days = parse_duration_days("1.5d").unwrap();
        assert!((days - 1.5).abs() < 0.001);
    }

    #[test]
    fn test_duration_days_from_hours() {
        let days = parse_duration_days("24h").unwrap();
        assert!((days - 1.0).abs() < f64::EPSILON);
    }
}
