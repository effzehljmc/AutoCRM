import { useSupabase } from '@/components/providers/supabase-provider';
import { AIFeedback, AIMessageSuggestion, FeedbackReason } from '@/types/ai-suggestion';
import { useCallback, useEffect, useState, useRef } from 'react';
import { useUserRole } from '@/hooks/useUserRole';
import { useUser } from '@/hooks/useUser';
import langfuse from '@/lib/langfuse/client';

interface TicketMessage {
  id: string;
  content: string;
  is_ai_generated: boolean;
  created_at: string;
}

export interface SuggestionState {
  suggestion: AIMessageSuggestion;
  status: 'loading' | 'success' | 'error';
  error?: string;
}

export function useAISuggestions(ticketId: string) {
  const { supabase } = useSupabase();
  const { isAdmin, isAgent } = useUserRole();
  const { user } = useUser();
  const [suggestions, setSuggestions] = useState<SuggestionState[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const fetchSuggestions = useCallback(async () => {
    try {
      setIsLoading(true);
      console.log('Fetching suggestions with auth state:', { isAdmin, isAgent });
      
      const { data, error, count } = await supabase
        .from('ai_suggestions')
        .select('*', { count: 'exact' })
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: true });

      console.log('Fetch result:', { 
        success: !error, 
        count, 
        error: error?.message,
        data: data?.length
      });

      if (error) throw error;

      setSuggestions(
        data.map(suggestion => ({
          suggestion,
          status: 'success'
        }))
      );
    } catch (err) {
      console.error('Error fetching AI suggestions:', err);
      setError(err instanceof Error ? err : new Error('Failed to fetch AI suggestions'));
    } finally {
      setIsLoading(false);
    }
  }, [ticketId, isAdmin, isAgent]);

  useEffect(() => {
    console.log('Setting up AI suggestions subscription for ticket:', ticketId);
    fetchSuggestions();

    // Clean up previous subscription if it exists
    if (channelRef.current) {
      console.log('Cleaning up previous AI suggestions subscription for ticket:', ticketId);
      channelRef.current.unsubscribe();
    }

    // Create new subscription
    channelRef.current = supabase
      .channel(`ai_suggestions:${ticketId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'ai_suggestions',
          filter: `ticket_id=eq.${ticketId}`
        },
        async (payload) => {
          console.log('Received AI suggestion update:', payload.eventType, 'for ticket:', ticketId);
          if (payload.eventType === 'INSERT') {
            const newSuggestion = payload.new as AIMessageSuggestion;
            setSuggestions(currentSuggestions => {
              const exists = currentSuggestions.some(s => s.suggestion.id === newSuggestion.id);
              if (exists) {
                return currentSuggestions;
              }
              return [...currentSuggestions, {
                suggestion: newSuggestion,
                status: 'success'
              }];
            });
          } else if (payload.eventType === 'DELETE') {
            setSuggestions(currentSuggestions => 
              currentSuggestions.filter(s => s.suggestion.id !== payload.old.id)
            );
          } else if (payload.eventType === 'UPDATE') {
            const updatedSuggestion = payload.new as AIMessageSuggestion;
            setSuggestions(currentSuggestions => {
              // If suggestion is accepted or rejected, remove it from the list
              if (updatedSuggestion.status === 'accepted' || updatedSuggestion.status === 'rejected') {
                return currentSuggestions.filter(s => s.suggestion.id !== updatedSuggestion.id);
              }
              // Otherwise update it
              return currentSuggestions.map(s => 
                s.suggestion.id === updatedSuggestion.id 
                  ? { ...s, suggestion: updatedSuggestion }
                  : s
              );
            });
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('Successfully subscribed to AI suggestions for ticket:', ticketId);
        } else if (status === 'CLOSED') {
          console.log('AI suggestions subscription closed for ticket:', ticketId);
        } else if (status === 'CHANNEL_ERROR') {
          console.error('Error in AI suggestions subscription for ticket:', ticketId);
        }
      });

    return () => {
      if (channelRef.current) {
        console.log('Unmounting: Cleaning up AI suggestions subscription for ticket:', ticketId);
        channelRef.current.unsubscribe();
        channelRef.current = null;
      }
    };
  }, [ticketId, fetchSuggestions]);

  const triggerSuggestion = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/ai/generate-suggestion', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ticketId }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate suggestion');
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error triggering suggestion:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [ticketId]);

  const storeFeedback = useCallback(
    async (feedback: AIFeedback) => {
      if (!user?.id) {
        // Wait for user data to be available
        await new Promise(resolve => setTimeout(resolve, 500));
        if (!user?.id) {
          throw new Error('No user ID available');
        }
      }

      const { data: suggestion } = await supabase
        .from('ai_suggestions')
        .select('*')
        .eq('id', feedback.suggestion_id)
        .single();

      if (!suggestion) {
        throw new Error('Suggestion not found');
      }

      const { data: ticket } = await supabase
        .from('tickets')
        .select(`
          *,
          messages:ticket_messages(
            id,
            content,
            is_ai_generated,
            created_at
          )
        `)
        .eq('id', feedback.ticket_id)
        .single();

      if (!ticket) {
        throw new Error('Ticket not found');
      }

      const now = new Date().toISOString();
      const feedbackStartTime = new Date().getTime();

      const feedbackTrace = langfuse.trace({
        name: 'suggestion-feedback',
        sessionId: suggestion?.metadata?.trace_id,
        input: {
          original_suggestion: {
            id: suggestion.id,
            content: suggestion.suggested_response,
            model: suggestion.metadata?.model,
            created_at: suggestion.created_at
          },
          ticket_context: {
            id: ticket.id,
            title: ticket.title,
            description: ticket.description,
            priority: ticket.priority,
            conversation_history: ticket.messages
              .sort((a: TicketMessage, b: TicketMessage) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
              .map((msg: TicketMessage) => ({
                content: msg.content,
                is_ai_generated: msg.is_ai_generated,
                created_at: msg.created_at,
                type: msg.is_ai_generated ? 'agent' : 'customer'
              }))
          },
          feedback: {
            type: feedback.feedback_type,
            reason: feedback.feedback_reason,
            agent_id: user.id
          }
        }
      });
      
      // First update the suggestion status
      const suggestionSpan = feedbackTrace.span({ 
        name: 'update-suggestion-status',
        input: {
          suggestion_id: feedback.suggestion_id,
          new_status: feedback.feedback_type === 'approval' ? 'accepted' : 'rejected',
          timestamp: now
        }
      });
      const { error: suggestionError } = await supabase
        .from('ai_suggestions')
        .update({
          status: feedback.feedback_type === 'approval' ? 'accepted' : 'rejected',
          updated_at: now,
        })
        .eq('id', feedback.suggestion_id);

      if (suggestionError) {
        suggestionSpan.update({ 
          metadata: { error: suggestionError, level: 'error' }
        });
        console.error('Error updating suggestion status:', suggestionError);
        throw suggestionError;
      }
      suggestionSpan.update({ metadata: { level: 'success' } });

      // Then store the feedback
      const feedbackSpan = feedbackTrace.span({ 
        name: 'store-feedback-event',
        input: {
          suggestion_id: feedback.suggestion_id,
          ticket_id: feedback.ticket_id,
          agent_id: user.id,
          feedback_type: feedback.feedback_type,
          feedback_reason: feedback.feedback_reason || null,
          agent_response: feedback.agent_response || null,
          metadata: feedback.metadata
        }
      });
      const { error: feedbackError } = await supabase
        .from('ai_feedback_events')
        .insert({
          suggestion_id: feedback.suggestion_id,
          ticket_id: feedback.ticket_id,
          agent_id: user.id,
          feedback_type: feedback.feedback_type,
          feedback_reason: feedback.feedback_reason || null,
          agent_response: feedback.agent_response || null,
          time_to_feedback: '0 seconds', // Default interval value
          metadata: {
            ...feedback.metadata,
            trace_id: feedbackTrace.id // Store feedback trace ID
          },
          created_at: now,
          updated_at: now
        });

      if (feedbackError) {
        feedbackSpan.update({ 
          metadata: { error: feedbackError, level: 'error' }
        });
        console.error('Error storing feedback event:', feedbackError);
        throw feedbackError;
      }
      feedbackSpan.update({ metadata: { level: 'success' } });

      const feedbackEndTime = new Date().getTime();
      const feedbackProcessingTime = feedbackEndTime - feedbackStartTime;
      const timeToFeedback = new Date(now).getTime() - new Date(suggestion.created_at).getTime();

      // Update the trace with final status
      await feedbackTrace.update({
        output: {
          feedback_result: {
            status: 'processed',
            feedback_type: feedback.feedback_type,
            processed_at: now,
            processing_time_ms: feedbackProcessingTime,
            metrics: {
              time_to_feedback_ms: timeToFeedback,
              was_edited: suggestion.updated_at !== suggestion.created_at,
              partial_use: feedback.metadata?.partial_use || false,
              quality_score: feedback.feedback_type === 'approval' ? 1.0 : 0.0
            }
          },
          suggestion_update: {
            new_status: feedback.feedback_type === 'approval' ? 'accepted' : 'rejected',
            update_timestamp: now,
            was_edited: suggestion.updated_at !== suggestion.created_at,
            agent_response: feedback.agent_response,
            edit_distance: feedback.agent_response ? 
              calculateEditDistance(suggestion.suggested_response, feedback.agent_response) : 
              null
          },
          performance_analysis: {
            response_length: suggestion.suggested_response.length,
            response_tokens: suggestion.metadata?.tokens_used?.total_tokens || 0,
            processing_time_ms: feedbackProcessingTime,
            total_interaction_time_ms: timeToFeedback + feedbackProcessingTime
          }
        },
        metadata: {
          completion_time: now,
          trace_id: feedbackTrace.id,
          environment: process.env.NODE_ENV
        }
      });

      // Make sure to flush events before returning
      await langfuse.flushAsync();
    },
    [supabase, user?.id]
  );

  const acceptSuggestion = useCallback(
    async (suggestion_id: string) => {
      const now = new Date().toISOString();
      const feedback: AIFeedback = {
        suggestion_id,
        ticket_id: ticketId,
        feedback_type: 'approval',
        updated_at: now
      };

      await storeFeedback(feedback);

      // Remove the suggestion from local state immediately
      setSuggestions(currentSuggestions => 
        currentSuggestions.filter(s => s.suggestion.id !== suggestion_id)
      );
    },
    [ticketId, storeFeedback]
  );

  const rejectSuggestion = useCallback(
    async (suggestion_id: string, reason: FeedbackReason, additionalFeedback?: string) => {
      const now = new Date().toISOString();
      const feedback: AIFeedback = {
        suggestion_id,
        ticket_id: ticketId,
        feedback_type: 'rejection',
        feedback_reason: reason,
        metadata: additionalFeedback ? { additional_feedback: additionalFeedback } : undefined,
        updated_at: now
      };

      try {
        // First update local state to ensure UI is responsive
        setSuggestions(currentSuggestions => 
          currentSuggestions.filter(s => s.suggestion.id !== suggestion_id)
        );

        // Then update the database
        await storeFeedback(feedback);
      } catch (error) {
        // If database update fails, revert the local state
        console.error('Error rejecting suggestion:', error);
        const failedSuggestion = suggestions.find(s => s.suggestion.id === suggestion_id);
        if (failedSuggestion) {
          setSuggestions(current => [...current, failedSuggestion]);
        }
        throw error;
      }
    },
    [ticketId, storeFeedback, suggestions]
  );

  return {
    suggestions,
    isLoading,
    error,
    refetch: fetchSuggestions,
    triggerSuggestion,
    acceptSuggestion,
    rejectSuggestion,
  };
}

// Add helper function for edit distance calculation
function calculateEditDistance(str1: string, str2: string): number {
  const m = str1.length;
  const n = str2.length;
  const dp: number[][] = Array(m + 1).fill(0).map(() => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) {
    for (let j = 0; j <= n; j++) {
      if (i === 0) dp[i][j] = j;
      else if (j === 0) dp[i][j] = i;
      else if (str1[i - 1] === str2[j - 1]) dp[i][j] = dp[i - 1][j - 1];
      else dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}
