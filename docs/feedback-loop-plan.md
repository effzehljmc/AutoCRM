# Feedback Loop & Escalation Workflow

This document outlines how to capture and leverage feedback from **AI-generated suggestions**, dynamically assign ticket priority, and establish a clear workflow for escalation and routing to human agents when necessary. Our goal is to close the loop on AI feedback by storing agent or customer input when AI suggestions are rejected (or significantly edited), analyzing that data, and refining future AI responses.

---

## 1. Overview

• Store agent and customer feedback for AI suggestions.  
• Dynamically assign ticket priority rather than a hardcoded default.  
• Automate escalation for complex or sensitive tickets (e.g., legal or billing issues).  
• Build a learning system that continuously improves AI suggestions based on real-world feedback events.

---

## 2. Feedback Flow & Learning System

1. **Store Feedback in a Specialized Table**  
   - Create a dedicated table called `ai_feedback_events` to record each "feedback event" for an AI suggestion. Unlike `ai_suggestions`, which holds the original suggestion, `ai_feedback_events` can log multiple events for the same suggestion if needed. Data to store:
     Required fields:
     - `suggestion_id`: UUID reference to `ai_suggestions`
     - `ticket_id`: UUID reference to the associated ticket
     - `feedback_type`: ENUM ('rejection', 'revision', 'approval')
     - `feedback_reason`: Required for rejection/revision, using predefined options:
       • "irrelevant"
       • "off-topic"
       • "incorrect info"
       • "too generic"
       • Other common reasons as needed
     Optional fields:
     - `agent_response`: The final approved or corrected response (if revised)
     - `metadata`: JSONB for additional context (e.g., reference URLs)
     - `time_to_feedback`: Time between suggestion creation and feedback
     - `created_at`, `updated_at`: Timestamps for when the event was logged
   - All feedback is immutable once submitted
   - No archiving or deletion - retain all feedback indefinitely

2. **Capture Feedback on Accept/Reject**  
   - Update your `acceptSuggestion` (or similar) function to:
     1. Update the `ai_suggestions` row (e.g., set `status` to `accepted` or `rejected`)
     2. Insert an immutable record into `ai_feedback_events`
   - Implement batch updates for frontend performance
   - No editing of feedback allowed after submission

3. **Scheduled Aggregation**  
   - Create a separate table for aggregated metrics
   - Run hourly aggregation jobs to compute:
     • Rejection rate by reason
     • Overall acceptance rate
     • Average confidence scores (accepted vs rejected)
     • Time-to-feedback metrics
     • Top feedback reasons
   - Store results in the aggregated metrics table for quick access
   - Use these metrics to identify trends and improvement areas

4. **Analytics Dashboard**
   - Initially show daily aggregated metrics
   - Display key metrics:
     • Acceptance/rejection rates over time
     • Most common feedback reasons
     • Average confidence scores comparison
     • Time-to-feedback trends
   - No real-time updates required initially
   - Focus on actionable insights for improving AI responses

---

## 3. Escalation & Routing

1. **Detect Complex Requests**  
   - Add a classification step (rule-based or AI-based) to examine the ticket's text. If it contains "legal," "urgent," or "escalation needed," mark it "Needs Escalation" or set priority to "high."

2. **Human Oversight Mode**  
   - For escalated tickets, notify a manager or route them to a specialized queue. Agents can see the AI's reasoning or confidence, providing transparency to validate urgency or catch errors.

3. **Continuous Improvement**  
   - As escalated tickets are resolved, consider logging the final resolution or "lessons learned" in either `ai_feedback_events` or a separate resolution table. This helps refine classification thresholds over time.

---

## 4. Dynamic Ticket Priority Assignment

1. **Define a Priority Scoring Method**  
   - Incorporate keywords, customer tier, and past history to assign a numeric priority score.

2. **Ticket Creation Trigger**  
   - On new ticket creation, run the scoring function. If the score exceeds a threshold, mark as "high" priority, otherwise default to "medium" or "low."

3. **Agent Overrides as Feedback**  
   - If an agent manually changes priority, record that in `ai_feedback_events` with a reason. Over time, you can learn from these overrides to calibrate your scoring.

---

## 5. Example Implementation Sketch

1. **Logging Rejected Suggestions**  
   - Update the suggestion itself in `ai_suggestions` (status: "rejected" or "accepted").  
   - If an agent sends revised text, insert a row in `ai_feedback_events` with `agent_response` and a `feedback_reason`.

2. **Aggregating Feedback**  
   - A nightly or periodic aggregator fetches all new rows in `ai_feedback_events`, categorizes them (e.g., top "feedback_reason"), and logs or stores these metrics for easy analysis.

3. **Dynamic Priority Assignment**  
   - Evaluate ticket descriptions for urgent words; add points for premium customers. Then update the ticket's priority accordingly.

---

## 6. Testing & Validation

1. Verify Rejected Suggestions  
   - Confirm your feedback table (`ai_feedback_events`) gets a new row each time a suggestion is rejected or heavily edited.

2. Feedback Aggregation  
   - Confirm your job or function logs daily counts by `feedback_reason`.

3. Priority Adjustments  
   - Confirm new tickets adopt the correct priority, and that manual overrides log a feedback event.

4. Escalation Triggers  
   - Confirm "high" priority or flagged keywords route tickets to a specialized queue or manager.

Once validated, this system captures real-world feedback, improving the AI and delivering continuous learning and growth.  

---

## Implementation Checklist

### Database Setup ✅
- [x] Create `update_updated_at_column()` function for timestamp management
- [x] Create `feedback_type` enum with states (rejection, revision, approval)
- [x] Create `ai_feedback_events` table with all necessary fields
- [x] Add RLS policies for proper access control
- [x] Create `is_admin()` helper function
- [x] Create aggregated_metrics table and functions
- [x] Implement feedback event triggers and functions
- [x] Set up proper foreign key relationships

### Testing Required ✅
- [x] Test `update_updated_at_column()` function
- [x] Test feedback_type enum constraints
- [x] Test RLS Policies
  1. Admin Access:
     - [x] Can view all feedback
     - [x] Can create feedback for any ticket
     - [x] Can update any feedback
     - [x] Can delete any feedback
  
  2. Agent Access:
     - [x] Can only view feedback for assigned tickets
     - [x] Can only create feedback for assigned tickets
     - [x] Cannot update any feedback
     - [x] Cannot delete any feedback
  
  3. Customer Access:
     - [x] Cannot view any feedback
     - [x] Cannot create any feedback
     - [x] Cannot update any feedback
     - [x] Cannot delete any feedback

### Frontend Integration 🚧
- [x] Implement batch feedback capture system
- [x] Create feedback form with required/optional fields:
  - Required: feedback_type, feedback_reason (for rejection/revision)
  - Optional: agent_response, metadata, time_to_feedback
- [x] Add predefined feedback reason options
- [x] Implement immutable feedback storage
- [x] Add daily aggregated metrics display
- [ ] Add feedback reason validation
- [ ] Implement feedback submission rate limiting
- [ ] Add feedback submission error handling
- [ ] Add feedback submission success notifications
- [ ] Add feedback history view for agents
- [ ] Add feedback export functionality for admins

### Analytics & Monitoring ⏳
- [x] Create aggregated_metrics table
- [x] Implement hourly aggregation job
- [x] Set up key metrics collection:
  - Rejection rate by reason
  - Overall acceptance rate
  - Average confidence comparison
  - Time-to-feedback
  - Top feedback reasons
- [x] Create analytics dashboard with daily view
- [ ] Add weekly trends analysis
- [ ] Add monthly performance reports
- [ ] Implement agent performance comparison
- [ ] Add feedback quality metrics
- [ ] Create automated performance alerts
- [ ] Add custom date range selection for metrics
- [ ] Implement metric export functionality
- [ ] Add metric visualization options

### Performance Optimization 🔄
- [ ] Implement caching for frequently accessed metrics
- [ ] Add database query optimization for large datasets
- [ ] Implement batch processing for feedback submissions
- [ ] Add rate limiting for API endpoints
- [ ] Optimize real-time updates
- [ ] Add performance monitoring
- [ ] Implement load testing

### Documentation 📚
- [ ] Add API documentation
- [ ] Create user guide for feedback system
- [ ] Document metrics calculations
- [ ] Add troubleshooting guide
- [ ] Create deployment guide
- [ ] Document security measures
- [ ] Add performance tuning guide

### Warnings ⚠️
1. The migration assumes the existence of `tickets`, `ai_suggestions`, and `profiles` tables
2. RLS policies need to be tested with real user roles and permissions
3. Frontend implementation will need to handle feedback type validation before sending to the backend
4. Ensure proper cleanup of test data to prevent interference with actual feedback events
5. Monitor performance impact of RLS policies on large datasets
6. Consider implementing rate limiting for feedback submissions
7. Ensure proper error handling for feedback submission failures
8. Batch updates may introduce slight delay in feedback visibility
9. Monitor cron job execution logs for any failures or delays
10. Predefined feedback reasons should be monitored and adjusted based on usage patterns

🎯 Next Priority Tasks:
1. Implement feedback submission rate limiting
2. Add comprehensive error handling for feedback submissions
3. Create weekly and monthly trend analysis views
4. Add agent performance comparison features
5. Implement caching for frequently accessed metrics
6. Create user documentation for the feedback system

🐧 Note: All database setup, testing requirements, and metrics collection have been completed. The next phase focuses on implementing the analytics dashboard to visualize the collected metrics. 