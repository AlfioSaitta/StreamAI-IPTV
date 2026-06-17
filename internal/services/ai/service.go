package ai

import (
	"context"
	"log"
)

// AIService for handling Gemini AI interactions
type AIService struct {
	ctx context.Context
}

// NewAIService creates a new AIService
func NewAIService() *AIService {
	return &AIService{}
}

// ServiceStartup is called when the service is started
func (s *AIService) ServiceStartup(ctx context.Context) error {
	s.ctx = ctx
	log.Println("AI Service Started")
	return nil
}

// ServiceShutdown is called when the service is stopped
func (s *AIService) ServiceShutdown() error {
	log.Println("AI Service Shutdown")
	return nil
}

// GetRecommendations forwards the prompt to the Gemini API
func (s *AIService) GetRecommendations(promptContext string) (string, error) {
	// TODO: Implement Gemini API call
	log.Printf("Received prompt for recommendations: %s", promptContext)
	return "[]", nil // Placeholder
}

// GetMovieEnrichment forwards the request to the Gemini API
func (s *AIService) GetMovieEnrichment(movieTitle string) (string, error) {
	// TODO: Implement Gemini API call
	log.Printf("Received request for movie enrichment: %s", movieTitle)
	return "{}", nil // Placeholder
}
