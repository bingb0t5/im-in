CREATE OR REPLACE FUNCTION public.apply_event_moderation_defaults()
RETURNS TRIGGER AS $$
DECLARE
    next_visibility TEXT := COALESCE(NEW.visibility, CASE WHEN COALESCE(NEW.is_public, false) THEN 'public' ELSE 'private' END);
    should_reset BOOLEAN := false;
BEGIN
    IF NEW.moderation_reasons IS NULL THEN
        NEW.moderation_reasons := ARRAY[]::TEXT[];
    END IF;

    IF TG_OP = 'INSERT' THEN
        should_reset := next_visibility IN ('public', 'semi_public');
    ELSE
        should_reset := NEW.visibility IS DISTINCT FROM OLD.visibility;

        IF NOT should_reset THEN
            IF next_visibility = 'semi_public' THEN
                should_reset := NEW.title IS DISTINCT FROM OLD.title
                    OR NEW.public_summary IS DISTINCT FROM OLD.public_summary
                    OR NEW.public_location_text IS DISTINCT FROM OLD.public_location_text
                    OR NEW.show_host_publicly IS DISTINCT FROM OLD.show_host_publicly;
            ELSE
                should_reset := NEW.title IS DISTINCT FROM OLD.title
                    OR NEW.description IS DISTINCT FROM OLD.description
                    OR NEW.public_summary IS DISTINCT FROM OLD.public_summary
                    OR NEW.location_text IS DISTINCT FROM OLD.location_text
                    OR NEW.public_location_text IS DISTINCT FROM OLD.public_location_text
                    OR NEW.show_host_publicly IS DISTINCT FROM OLD.show_host_publicly;
            END IF;
        END IF;
    END IF;

    IF next_visibility = 'private' THEN
        NEW.public_discovery_enabled := false;
        NEW.moderation_status := 'not_required';
        NEW.moderation_risk_level := NULL;
        NEW.moderation_action := NULL;
        NEW.moderation_confidence := NULL;
        NEW.moderation_reasons := ARRAY[]::TEXT[];
        NEW.moderation_input_hash := NULL;
        NEW.moderated_at := NULL;
        NEW.moderation_archived_at := NULL;
        NEW.moderation_override := NULL;
        RETURN NEW;
    END IF;

    IF NEW.moderation_override IS NOT NULL AND NOT should_reset THEN
        CASE NEW.moderation_override
            WHEN 'force_visible', 'mark_safe' THEN
                NEW.public_discovery_enabled := true;
                NEW.moderation_status := 'approved';
                NEW.moderation_action := 'allow';
                NEW.moderated_at := COALESCE(NEW.moderated_at, now());
            WHEN 'force_limited' THEN
                NEW.public_discovery_enabled := false;
                NEW.moderation_status := 'limited';
                NEW.moderation_action := 'limit_visibility';
                NEW.moderated_at := COALESCE(NEW.moderated_at, now());
            WHEN 'hide' THEN
                NEW.public_discovery_enabled := false;
                NEW.moderation_status := 'review';
                NEW.moderation_action := 'require_review';
                NEW.moderated_at := COALESCE(NEW.moderated_at, now());
            WHEN 'mark_spam' THEN
                NEW.public_discovery_enabled := false;
                NEW.moderation_status := 'blocked';
                NEW.moderation_risk_level := 'high';
                NEW.moderation_action := 'block';
                NEW.moderated_at := COALESCE(NEW.moderated_at, now());
        END CASE;
        RETURN NEW;
    END IF;

    IF should_reset THEN
        NEW.public_discovery_enabled := false;
        NEW.moderation_status := 'pending';
        NEW.moderation_risk_level := NULL;
        NEW.moderation_action := NULL;
        NEW.moderation_confidence := NULL;
        NEW.moderation_reasons := ARRAY[]::TEXT[];
        NEW.moderation_input_hash := NULL;
        NEW.moderated_at := NULL;
        NEW.moderation_archived_at := NULL;
        NEW.moderation_override := NULL;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
