import React, { useState } from 'react';
import { ShoppingCart } from 'lucide-react';
import SuggestionsEditor from './SuggestionsEditor';

// Onboarding wrapper shown once per household, right after creation. Reuses
// SuggestionsEditor in wizard mode. Welcome panel → editor → onDone writes the
// onboarding_completed flag and lands the user in Shop mode.

export default function Onboarding(props) {
  const {
    displayName,
    aisles, categories, visibleItems, libraryItems,
    onRenameAisle, onAddAisle, onDeleteAisle, onReorderAisles,
    onRenameCategory, onAddCategory, onMoveCategory, onMergeCategory,
    onComplete,
  } = props;

  const [step, setStep] = useState('welcome');

  if (step === 'welcome') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: '#F7F7F7' }}>
        <div className="bg-white rounded-3xl shadow-lg p-8 max-w-md w-full border border-gray-200">
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4" style={{ backgroundColor: '#FF7A7A' }}>
              <ShoppingCart size={32} className="text-white" />
            </div>
            <h1 className="text-3xl font-bold text-gray-800 mb-2">
              {displayName ? `Welcome, ${displayName}!` : 'Welcome!'}
            </h1>
            <p className="text-gray-600 font-medium mb-6">Let's set up your shopping list.</p>
          </div>
          <div className="space-y-3 text-sm text-gray-600 mb-6">
            <p>
              On the next screen you can organize aisles to match how you typically walk through your
              store. Reorder, rename, or remove anything you don't need. You can always change this later
              in Settings.
            </p>
          </div>
          <button
            onClick={() => setStep('editor')}
            className="w-full py-3 rounded-xl font-bold text-white transition-colors"
            style={{ backgroundColor: '#FF7A7A' }}
          >
            Continue
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#F7F7F7' }}>
      <div className="max-w-3xl mx-auto px-4 py-6">
        <SuggestionsEditor
          aisles={aisles}
          categories={categories}
          visibleItems={visibleItems}
          libraryItems={libraryItems}
          onRenameAisle={onRenameAisle}
          onAddAisle={onAddAisle}
          onDeleteAisle={onDeleteAisle}
          onReorderAisles={onReorderAisles}
          onRenameCategory={onRenameCategory}
          onAddCategory={onAddCategory}
          onMoveCategory={onMoveCategory}
          onMergeCategory={onMergeCategory}
          onboarding={true}
          onDone={onComplete}
        />
      </div>
    </div>
  );
}
